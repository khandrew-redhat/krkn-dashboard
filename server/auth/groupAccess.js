/** Group-scoped admin: platform admin who is a member of the group. */
export function canManageGroup(user, groupId) {
  const gid = parseInt(groupId, 10);
  if (!gid || !user) return false;
  return (
    user.role === "admin" &&
    Array.isArray(user.groupIds) &&
    user.groupIds.includes(gid)
  );
}

export function parseGroupId(param) {
  const id = parseInt(param, 10);
  if (!id || Number.isNaN(id)) return null;
  return id;
}
