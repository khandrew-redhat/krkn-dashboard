import { listPoliciesForUser } from "../db/policies.js";

const ROLE_CAPS = {
  viewer: ["view"],
  user: ["view", "run", "cancel"],
  admin: ["view", "run", "cancel", "admin"],
};

const PERM_RANK = { view: 1, run: 2, cancel: 3, admin: 4 };

function matchesCluster(policyClusterKey, requestedKey) {
  if (policyClusterKey === "*") return true;
  return policyClusterKey === requestedKey;
}

function grantsInclude(policies, action, clusterKey) {
  const need = PERM_RANK[action] ?? 0;
  for (const p of policies) {
    if (!matchesCluster(p.cluster_key, clusterKey)) continue;
    const have = PERM_RANK[p.permission] ?? 0;
    if (have >= need) return true;
    if (p.permission === "admin") return true;
  }
  return false;
}

export async function authorize(user, action, clusterKey = "*") {
  if (!user) {
    const err = new Error("Authentication required");
    err.status = 401;
    throw err;
  }
  if (user.role === "admin") return true;

  const caps = ROLE_CAPS[user.role] || [];
  if (!caps.includes(action)) {
    const err = new Error("Role does not allow this action");
    err.status = 403;
    throw err;
  }

  const policies = await listPoliciesForUser(user.id, user.groupIds || []);
  const normalized = policies.map((p) => ({
    cluster_key: p.cluster_key,
    permission: p.permission,
  }));

  if (grantsInclude(normalized, action, clusterKey)) return true;

  const err = new Error("Insufficient cluster permissions");
  err.status = 403;
  throw err;
}

export function requirePolicy(action, getClusterKey = () => "*") {
  return async (req, res, next) => {
    try {
      const clusterKey = await getClusterKey(req);
      await authorize(req.user, action, clusterKey);
      next();
    } catch (e) {
      res.status(e.status || 403).json({ error: e.message });
    }
  };
}

export function filterGroupIdsForUser(user) {
  if (!user) return [];
  if (user.role === "admin") return null;
  return user.groupIds || [];
}
