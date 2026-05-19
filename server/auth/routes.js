import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import multer from "multer";
import path from "path";

import { recordAudit } from "../db/audit.js";
import * as groupsDb from "../db/groups.js";
import {
  createKubeconfigRecord,
  deleteKubeconfig,
  ensureKubeconfigsDir,
  getKubeconfigById,
  kubeconfigFilePath,
  listKubeconfigsForUser,
} from "../db/kubeconfigs.js";
import * as policiesDb from "../db/policies.js";
import * as usersDb from "../db/users.js";
import { countUsers } from "../db/users.js";
import { authorize } from "./policy.js";
import { hashPassword, verifyPassword } from "./password.js";
import { requireRole } from "./middleware.js";
import { attachUserToSession } from "./session.js";
import { deriveClusterKey, deriveContextName } from "./kubeconfigUtil.js";
import { kubeconfigsDir } from "../db/connection.js";
import { consumeInitialLoginHint } from "./initialLoginHint.js";
import {
  canManageGroup,
  parseGroupId,
} from "./groupAccess.js";

const router = Router();

router.use(async (req, res, next) => {
  if (
    req.path === "/login" ||
    req.path === "/bootstrap-status" ||
    req.path === "/initial-login-hint"
  ) {
    return next();
  }
  const { loadSessionUser } = await import("./session.js");
  const user = req.session?.user || (await loadSessionUser(req));
  if (!user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  req.user = user;
  if (!req.session.user) req.session.user = user;
  next();
});

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 20;

function checkLoginRate(ip) {
  const now = Date.now();
  let entry = loginAttempts.get(ip);
  if (!entry || now - entry.start > LOGIN_WINDOW_MS) {
    entry = { start: now, count: 0 };
    loginAttempts.set(ip, entry);
  }
  entry.count += 1;
  if (entry.count > LOGIN_MAX_ATTEMPTS) {
    const err = new Error("Too many login attempts");
    err.status = 429;
    throw err;
  }
}

router.get("/bootstrap-status", async (_req, res) => {
  const count = await countUsers();
  res.json({ needsSetup: count === 0 });
});

/** One-time prefill for login after first bootstrap (consumes INITIAL_ADMIN.txt). */
router.get("/initial-login-hint", async (_req, res) => {
  try {
    const hint = await consumeInitialLoginHint();
    res.json(hint);
  } catch (e) {
    console.error("[auth] initial-login-hint:", e);
    res.status(500).json({ available: false });
  }
});

router.post("/login", async (req, res) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    checkLoginRate(ip);
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }
    const row = await usersDb.findByUsername(username);
    if (!row) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const ok = await verifyPassword(password, row.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const user = await attachUserToSession(req, row);
    res.json({ user });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("krkn.sid");
    res.json({ ok: true });
  });
});

router.get("/me", async (req, res) => {
  res.json({ user: req.user });
});

router.post("/change-password", async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 8) {
    return res
      .status(400)
      .json({ error: "New password must be at least 8 characters" });
  }
  const row = await usersDb.findById(req.user.id);
  if (!row) return res.status(401).json({ error: "Not authenticated" });
  const mustChange = row.must_change_password === 1;
  if (!mustChange) {
    const ok = await verifyPassword(currentPassword || "", row.password_hash);
    if (!ok) {
      return res.status(400).json({ error: "Current password is incorrect" });
    }
  }
  const passwordHash = await hashPassword(newPassword);
  await usersDb.updateUser(row.id, {
    passwordHash,
    mustChangePassword: false,
  });
  const updated = await usersDb.findById(row.id);
  const user = await attachUserToSession(req, updated);
  res.json({ user });
});

// --- Admin: users ---
router.get("/users", requireRole("admin"), async (_req, res) => {
  const users = await usersDb.listUsers();
  const withGroups = await Promise.all(
    users.map(async (u) => ({
      ...u,
      mustChangePassword: Boolean(u.must_change_password),
      groupIds: await usersDb.getUserGroupIds(u.id),
    }))
  );
  res.json({ users: withGroups });
});

router.post("/users", requireRole("admin"), async (req, res) => {
  const { username, password, role, groupIds = [] } = req.body || {};
  if (!username || !password || !role) {
    return res.status(400).json({ error: "username, password, and role required" });
  }
  if (!["admin", "user", "viewer"].includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }
  const existing = await usersDb.findByUsername(username);
  if (existing) {
    return res.status(409).json({ error: "Username already exists" });
  }
  const passwordHash = await hashPassword(password);
  const userId = await usersDb.createUser({
    username,
    passwordHash,
    role,
    mustChangePassword: true,
  });
  if (groupIds.length) {
    await usersDb.setUserGroups(userId, groupIds);
  }
  await recordAudit({
    userId: req.user.id,
    action: "user.created",
    resourceType: "user",
    resourceId: String(userId),
    metadata: { username, role },
  });
  res.status(201).json({ id: userId });
});

router.patch("/users/:id", requireRole("admin"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { role, disabled, groupIds, password } = req.body || {};
  if (role && !["admin", "user", "viewer"].includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }
  const updates = {};
  if (role != null) updates.role = role;
  if (disabled != null) updates.disabled = disabled;
  if (password) {
    updates.passwordHash = await hashPassword(password);
    updates.mustChangePassword = true;
  }
  await usersDb.updateUser(id, updates);
  if (Array.isArray(groupIds)) {
    await usersDb.setUserGroups(id, groupIds);
  }
  res.json({ ok: true });
});

// --- Groups ---
router.get("/groups", requireRole("admin"), async (_req, res) => {
  const groups = await groupsDb.listGroups();
  res.json({ groups });
});

router.post("/groups", requireRole("admin"), async (req, res) => {
  const { name, description } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });
  const existing = await groupsDb.findGroupByName(name);
  if (existing) return res.status(409).json({ error: "Group exists" });
  const id = await groupsDb.createGroup({ name, description });
  res.status(201).json({ id });
});

router.get("/groups/:id", requireRole("admin"), async (req, res) => {
  const groupId = parseGroupId(req.params.id);
  if (!groupId) return res.status(400).json({ error: "Invalid group id" });

  const group = await groupsDb.findGroupById(groupId);
  if (!group) return res.status(404).json({ error: "Group not found" });

  const members = await groupsDb.listGroupMembers(groupId);
  const policyRows = await policiesDb.listPoliciesForGroup(groupId);
  const policies = policyRows.map((p) => ({
    id: p.id,
    groupId,
    clusterKey: p.cluster_key,
    permission: p.permission,
    createdAt: p.created_at,
  }));

  res.json({
    group: {
      id: group.id,
      name: group.name,
      description: group.description,
      createdAt: group.created_at,
    },
    members,
    policies,
    canManage: canManageGroup(req.user, groupId),
  });
});

router.post("/groups/:id/members", requireRole("admin"), async (req, res) => {
  const groupId = parseGroupId(req.params.id);
  if (!groupId) return res.status(400).json({ error: "Invalid group id" });
  if (!canManageGroup(req.user, groupId)) {
    return res.status(403).json({ error: "You must be an admin member of this group" });
  }

  const userId = parseInt(req.body?.userId, 10);
  if (!userId) return res.status(400).json({ error: "userId required" });

  const target = await usersDb.findById(userId);
  if (!target) return res.status(404).json({ error: "User not found" });

  await groupsDb.addUserToGroup(userId, groupId);
  await recordAudit({
    groupId,
    userId: req.user.id,
    action: "group.member_added",
    resourceType: "user",
    resourceId: String(userId),
    metadata: { username: target.username },
  });
  res.status(201).json({ ok: true });
});

router.delete(
  "/groups/:id/members/:userId",
  requireRole("admin"),
  async (req, res) => {
    const groupId = parseGroupId(req.params.id);
    const userId = parseInt(req.params.userId, 10);
    if (!groupId || !userId) {
      return res.status(400).json({ error: "Invalid id" });
    }
    if (!canManageGroup(req.user, groupId)) {
      return res.status(403).json({ error: "You must be an admin member of this group" });
    }

    await groupsDb.removeUserFromGroup(userId, groupId);
    await recordAudit({
      groupId,
      userId: req.user.id,
      action: "group.member_removed",
      resourceType: "user",
      resourceId: String(userId),
    });
    res.json({ ok: true });
  }
);

router.post("/groups/:id/policies", requireRole("admin"), async (req, res) => {
  const groupId = parseGroupId(req.params.id);
  if (!groupId) return res.status(400).json({ error: "Invalid group id" });
  if (!canManageGroup(req.user, groupId)) {
    return res.status(403).json({ error: "You must be an admin member of this group" });
  }

  const { clusterKey, permission } = req.body || {};
  if (!clusterKey || !permission) {
    return res.status(400).json({ error: "clusterKey and permission required" });
  }
  if (!policiesDb.isValidPermission(permission)) {
    return res.status(400).json({ error: "Invalid permission" });
  }

  const group = await groupsDb.findGroupById(groupId);
  if (!group) return res.status(404).json({ error: "Group not found" });

  try {
    const id = await policiesDb.createPolicy({
      subjectId: groupId,
      clusterKey: String(clusterKey).trim(),
      permission,
    });
    await recordAudit({
      groupId,
      userId: req.user.id,
      action: "policy.created",
      resourceType: "policy",
      resourceId: String(id),
      metadata: { clusterKey, permission },
    });
    res.status(201).json({ id });
  } catch (e) {
    if (/UNIQUE constraint/i.test(String(e?.message || ""))) {
      return res.status(409).json({ error: "Policy already exists for this group and cluster" });
    }
    throw e;
  }
});

router.delete(
  "/groups/:id/policies/:policyId",
  requireRole("admin"),
  async (req, res) => {
    const groupId = parseGroupId(req.params.id);
    const policyId = parseInt(req.params.policyId, 10);
    if (!groupId || !policyId) {
      return res.status(400).json({ error: "Invalid id" });
    }
    if (!canManageGroup(req.user, groupId)) {
      return res.status(403).json({ error: "You must be an admin member of this group" });
    }

    const row = await policiesDb.getGroupPolicyById(policyId, groupId);
    if (!row) return res.status(404).json({ error: "Policy not found" });

    await policiesDb.deletePolicy(policyId);
    await recordAudit({
      groupId,
      userId: req.user.id,
      action: "policy.deleted",
      resourceType: "policy",
      resourceId: String(policyId),
    });
    res.json({ ok: true });
  }
);

router.delete("/groups/:id", requireRole("admin"), async (req, res) => {
  const groupId = parseGroupId(req.params.id);
  if (!groupId) return res.status(400).json({ error: "Invalid group id" });
  await groupsDb.deleteGroup(groupId);
  res.json({ ok: true });
});

// --- Policies (group-only; create via group detail) ---
router.get("/policies", requireRole("admin"), async (_req, res) => {
  const policies = await policiesDb.listPoliciesWithGroupNames();
  res.json({ policies });
});

router.post("/policies", requireRole("admin"), async (req, res) => {
  const groupId = parseInt(req.body?.groupId ?? req.body?.subjectId, 10);
  const { clusterKey, permission } = req.body || {};
  if (!groupId || !clusterKey || !permission) {
    return res.status(400).json({ error: "groupId, clusterKey, and permission required" });
  }
  if (!canManageGroup(req.user, groupId)) {
    return res.status(403).json({ error: "You must be an admin member of this group" });
  }
  if (!policiesDb.isValidPermission(permission)) {
    return res.status(400).json({ error: "Invalid permission" });
  }

  const group = await groupsDb.findGroupById(groupId);
  if (!group) return res.status(404).json({ error: "Group not found" });

  try {
    const id = await policiesDb.createPolicy({
      subjectId: groupId,
      clusterKey: String(clusterKey).trim(),
      permission,
    });
    res.status(201).json({ id });
  } catch (e) {
    if (/UNIQUE constraint/i.test(String(e?.message || ""))) {
      return res.status(409).json({ error: "Policy already exists" });
    }
    throw e;
  }
});

router.delete("/policies/:id", requireRole("admin"), async (req, res) => {
  const policyId = parseInt(req.params.id, 10);
  const row = await policiesDb.getPolicyById(policyId);
  if (!row) return res.status(404).json({ error: "Policy not found" });

  if (!canManageGroup(req.user, row.subject_id)) {
    return res.status(403).json({ error: "You must be an admin member of this group" });
  }
  await policiesDb.deletePolicy(policyId);
  res.json({ ok: true });
});

// --- Kubeconfigs ---
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureKubeconfigsDir().then(() => cb(null, kubeconfigsDir));
    },
    filename: (_req, _file, cb) => {
      cb(null, `upload-${crypto.randomBytes(8).toString("hex")}`);
    },
  }),
});

router.get("/kubeconfigs", async (req, res) => {
  const isAdmin = req.user.role === "admin";
  const list = await listKubeconfigsForUser(
    req.user.id,
    req.user.groupIds || [],
    isAdmin
  );
  res.json({ kubeconfigs: list });
});

router.post(
  "/kubeconfigs",
  requireRole("admin", "user"),
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file?.path) {
        return res.status(400).json({ error: "Kubeconfig file required" });
      }
      const name = req.body?.name || req.file.originalname || "kubeconfig";
      const groupId = req.body?.groupId
        ? parseInt(req.body.groupId, 10)
        : null;
      const clusterKey = await deriveClusterKey(req.file.path);
      const contextName = await deriveContextName(req.file.path);
      const storagePath = kubeconfigFilePath("pending");
      const id = await createKubeconfigRecord({
        name,
        ownerUserId: req.user.id,
        groupId,
        clusterKey,
        contextName,
        storagePath: "pending",
      });
      const finalPath = kubeconfigFilePath(id);
      fs.renameSync(req.file.path, finalPath);
      const { run } = await import("../db/connection.js");
      await run(`UPDATE kubeconfigs SET storage_path = ? WHERE id = ?`, [
        finalPath,
        id,
      ]);
      await recordAudit({
        groupId,
        userId: req.user.id,
        action: "kubeconfig.created",
        resourceType: "kubeconfig",
        resourceId: String(id),
        metadata: { name, clusterKey },
      });
      res.status(201).json({ id, clusterKey, contextName });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

router.delete("/kubeconfigs/:id", requireRole("admin", "user"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = await getKubeconfigById(id);
  if (!row) return res.status(404).json({ error: "Not found" });
  if (req.user.role !== "admin" && row.owner_user_id !== req.user.id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  await deleteKubeconfig(id);
  res.json({ ok: true });
});

router.get("/audit", async (req, res) => {
  const { listAuditForGroups } = await import("../db/audit.js");
  const groupIds =
    req.user.role === "admin"
      ? (await groupsDb.listGroups()).map((g) => g.id)
      : req.user.groupIds || [];
  const events = await listAuditForGroups(groupIds, {
    limit: parseInt(req.query.limit, 10) || 100,
  });
  res.json({ events });
});

export default router;
