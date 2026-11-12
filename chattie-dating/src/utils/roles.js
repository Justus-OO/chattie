export const USER_ROLES = {
  CLIENT: 'client',
  MODEL: 'model',
  ADMIN: 'admin',
};

export function getUserRole(user) {
  const rawRole = user?.role ?? user?.userRole ?? user?.user_type ?? user?.type;
  const role = String(rawRole || USER_ROLES.CLIENT).toLowerCase();

  if (role === 'creator' || role === 'operator') {
    return USER_ROLES.MODEL;
  }

  return Object.values(USER_ROLES).includes(role) ? role : USER_ROLES.CLIENT;
}

export function getRoleHome(user) {
  const role = getUserRole(user);

  if (role === USER_ROLES.ADMIN) return '/admin/dashboard';
  if (role === USER_ROLES.MODEL) return '/model/dashboard';
  return '/discover';
}
