/** RBAC role — Phase 02-এ Nest guard আর Next middleware দুই জায়গায় ব্যবহার হবে। */
export const ROLES = [
  'SUPER_ADMIN',
  'ORDER_MANAGER',
  'DESIGNER',
  'ACCOUNTANT',
  'CUSTOMER',
] as const;

export type Role = (typeof ROLES)[number];

/** অ্যাডমিন প্যানেলে ঢুকতে পারবে যারা — `(admin)` route group-এর guard এটা দেখবে। */
export const STAFF_ROLES: readonly Role[] = [
  'SUPER_ADMIN',
  'ORDER_MANAGER',
  'DESIGNER',
  'ACCOUNTANT',
];

export const isStaff = (role: Role): boolean => STAFF_ROLES.includes(role);
