// Initial operational defaults, not approved business requirements. See README.
export const authRateLimitPolicies = {
  login: { requests: 20, windowSeconds: 300 },
  register: { requests: 5, windowSeconds: 900 },
  google: { requests: 20, windowSeconds: 300 },
  refresh: { requests: 60, windowSeconds: 60 },
  logout: { requests: 60, windowSeconds: 60 },
  'forgot-password': { requests: 10, windowSeconds: 900 },
  'reset-password': { requests: 10, windowSeconds: 900 },
} as const;

export type AuthRateLimitOperation = keyof typeof authRateLimitPolicies;
