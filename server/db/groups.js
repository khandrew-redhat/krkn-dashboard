import { all, get, run } from "./connection.js";

export async function createGroup({ name, description = null }) {
  const result = await run(
    `INSERT INTO groups (name, description) VALUES (?, ?)`,
    [name, description]
  );
  return result.lastID;
}

export async function listGroups() {
  return all(`SELECT id, name, description, created_at FROM groups ORDER BY name`);
}

export async function findGroupById(id) {
  return get(`SELECT * FROM groups WHERE id = ?`, [id]);
}

export async function findGroupByName(name) {
  return get(`SELECT * FROM groups WHERE name = ? COLLATE NOCASE`, [name]);
}

export async function addUserToGroup(userId, groupId) {
  await run(
    `INSERT OR IGNORE INTO user_groups (user_id, group_id) VALUES (?, ?)`,
    [userId, groupId]
  );
}

export async function deleteGroup(id) {
  await run(`DELETE FROM groups WHERE id = ?`, [id]);
}

export async function listGroupMembers(groupId) {
  return all(
    `SELECT u.id, u.username, u.role FROM users u
     INNER JOIN user_groups ug ON ug.user_id = u.id
     WHERE ug.group_id = ?`,
    [groupId]
  );
}

export async function removeUserFromGroup(userId, groupId) {
  await run(`DELETE FROM user_groups WHERE user_id = ? AND group_id = ?`, [
    userId,
    groupId,
  ]);
}
