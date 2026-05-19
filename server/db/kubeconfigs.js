import fs from "fs";
import path from "path";

import { all, get, kubeconfigsDir, run } from "./connection.js";

export async function createKubeconfigRecord({
  name,
  ownerUserId,
  groupId,
  clusterKey,
  contextName,
  storagePath,
}) {
  const result = await run(
    `INSERT INTO kubeconfigs (name, owner_user_id, group_id, cluster_key, context_name, storage_path)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name, ownerUserId, groupId, clusterKey, contextName, storagePath]
  );
  return result.lastID;
}

export async function getKubeconfigById(id) {
  return get(`SELECT * FROM kubeconfigs WHERE id = ?`, [id]);
}

export async function listKubeconfigsForUser(userId, groupIds, isAdmin) {
  if (isAdmin) {
    return all(
      `SELECT id, name, owner_user_id, group_id, cluster_key, context_name, created_at
       FROM kubeconfigs ORDER BY name`
    );
  }
  const conditions = [`owner_user_id = ?`];
  const params = [userId];
  if (groupIds.length) {
    const ph = groupIds.map(() => "?").join(",");
    conditions.push(`group_id IN (${ph})`);
    params.push(...groupIds);
  }
  return all(
    `SELECT id, name, owner_user_id, group_id, cluster_key, context_name, created_at
     FROM kubeconfigs WHERE ${conditions.join(" OR ")} ORDER BY name`,
    params
  );
}

export async function deleteKubeconfig(id) {
  const row = await getKubeconfigById(id);
  if (!row) return false;
  if (row.storage_path && fs.existsSync(row.storage_path)) {
    fs.unlinkSync(row.storage_path);
  }
  await run(`DELETE FROM kubeconfigs WHERE id = ?`, [id]);
  return true;
}

export function kubeconfigFilePath(id) {
  return path.join(kubeconfigsDir, String(id));
}

export async function ensureKubeconfigsDir() {
  fs.mkdirSync(kubeconfigsDir, { recursive: true });
}
