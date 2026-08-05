const APPROVAL_MATRIX = Object.freeze({
  LOW: ['DISCIPLINE_LEAD'],
  MEDIUM: ['DISCIPLINE_LEAD', 'DATA_GOVERNANCE'],
  HIGH: ['DISCIPLINE_LEAD', 'OPERATIONS', 'DATA_GOVERNANCE'],
  SAFETY_CRITICAL: ['DISCIPLINE_LEAD', 'OPERATIONS', 'DATA_GOVERNANCE', 'HSE'],
});

function normalizeCriticality(rawRisk = {}) {
  const value = String(
    rawRisk.criticality ||
      rawRisk.level ||
      rawRisk.risk_level ||
      'LOW'
  ).toUpperCase();
  return APPROVAL_MATRIX[value] ? value : 'LOW';
}

export function requiredRolesForPackage(changePackage) {
  const criticality = normalizeCriticality(changePackage?.risk || {});
  return {
    criticality,
    requiredRoles: APPROVAL_MATRIX[criticality],
  };
}

export function hasMocReference(changePackage) {
  const metadata = changePackage?.metadata || {};
  const scope = changePackage?.scope || {};
  return Boolean(
    metadata.moc_reference ||
      metadata.moc_id ||
      metadata.mocRef ||
      scope.moc_reference ||
      scope.moc_id
  );
}

export function approvalsSatisfied(requiredRoles, approvedRoles = []) {
  const approvedSet = new Set(approvedRoles.map((r) => String(r).toUpperCase()));
  return requiredRoles.every((requiredRole) => approvedSet.has(requiredRole));
}

export function normalizeRole(role) {
  return String(role || '').trim().toUpperCase();
}
