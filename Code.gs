// =============================================================================
// CODE.GS — Portfolio Compliance Tracker Demo
// Public demo version: no authentication, no company data, no real emails.
// Data is stored in Script Properties so the demo can run without a spreadsheet.
// =============================================================================

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('ComplianceOps Demo Tracker')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function setupDemoData() {
  seedDemoData_(true);
  return { success: true, message: 'Demo data has been reset successfully.' };
}

function getAppData() {
  const data = getState_();
  refreshStatuses_(data);
  saveState_(data);
  return buildPayload_(data);
}

function getDashboard() {
  const data = getState_();
  refreshStatuses_(data);
  saveState_(data);
  return buildDashboard_(data);
}

function getNotifications() {
  const data = getState_();
  refreshStatuses_(data);
  saveState_(data);
  return buildNotifications_(data);
}

function getAuditLog() {
  const data = getState_();
  return (data.audit || []).slice().reverse();
}

function addObligation(payload) {
  validatePayload_(payload, ['country', 'entity', 'obligation', 'regulator', 'frequency', 'nextDue', 'owner']);
  const data = getState_();
  const exists = data.obligations.some(o => sameKey_(o, payload));
  if (exists) return { success: false, message: 'This obligation already exists for the selected country/entity.' };

  const item = normalizeObligation_({
    id: Utilities.getUuid(),
    country: payload.country,
    entity: payload.entity,
    obligation: payload.obligation,
    regulator: payload.regulator,
    frequency: payload.frequency,
    lastDone: payload.lastDone || '',
    nextDue: payload.nextDue,
    status: payload.status || 'Pending',
    owner: payload.owner,
    notes: payload.notes || '',
    evidence: payload.evidence || '',
    alertEmail: 'demo-alerts@example.com',
    completedBy: payload.completedBy || '',
    lastUpdated: today_()
  });

  data.obligations.push(item);
  refreshStatuses_(data);
  addAudit_(data, 'ADD', item, 'New Row', '', item.obligation);
  saveState_(data);
  return { success: true, message: 'Obligation added successfully.', data: buildPayload_(data) };
}

function submitUpdate(payload) {
  validatePayload_(payload, ['id']);
  const data = getState_();
  const idx = data.obligations.findIndex(o => o.id === payload.id);
  if (idx === -1) return { success: false, message: 'Obligation not found.' };

  const item = data.obligations[idx];
  const fields = ['country','entity','obligation','regulator','frequency','lastDone','nextDue','status','owner','notes','evidence','completedBy'];
  let changes = 0;

  fields.forEach(field => {
    if (payload[field] === undefined || payload[field] === null) return;
    const oldValue = String(item[field] || '');
    const newValue = String(payload[field] || '');
    if (oldValue !== newValue) {
      item[field] = newValue;
      changes++;
      addAudit_(data, 'UPDATE', item, label_(field), oldValue || '—', newValue || '—');
    }
  });

  if (payload.status === 'Completed' && !item.lastDone) item.lastDone = today_();
  if (payload.status === 'Completed' && !item.completedBy) item.completedBy = 'Demo User';
  item.lastUpdated = today_();
  data.obligations[idx] = normalizeObligation_(item);

  refreshStatuses_(data);
  saveState_(data);
  return { success: true, message: changes ? 'Obligation updated successfully.' : 'No changes were detected.', data: buildPayload_(data) };
}

function deleteObligation(payload) {
  validatePayload_(payload, ['id', 'reason']);
  const data = getState_();
  const idx = data.obligations.findIndex(o => o.id === payload.id);
  if (idx === -1) return { success: false, message: 'Obligation not found.' };
  const [removed] = data.obligations.splice(idx, 1);
  addAudit_(data, 'DELETE', removed, 'Deleted Obligation', removed.obligation, payload.reason);
  saveState_(data);
  return { success: true, message: 'Obligation deleted and audit log updated.', data: buildPayload_(data) };
}

function bulkDeleteObligations(payload) {
  validatePayload_(payload, ['country', 'entity', 'obligations', 'reason']);
  const data = getState_();
  const names = new Set(payload.obligations || []);
  const removed = [];
  data.obligations = data.obligations.filter(o => {
    const match = o.country === payload.country && o.entity === payload.entity && names.has(o.obligation);
    if (match) removed.push(o);
    return !match;
  });
  removed.forEach(o => addAudit_(data, 'DELETE', o, 'Bulk Delete', o.obligation, payload.reason));
  saveState_(data);
  return { success: true, message: `${removed.length} obligation(s) deleted.`, data: buildPayload_(data) };
}

function deleteEntity(payload) {
  validatePayload_(payload, ['country', 'entity', 'reason']);
  const data = getState_();
  const removed = [];
  data.obligations = data.obligations.filter(o => {
    const match = o.country === payload.country && o.entity === payload.entity;
    if (match) removed.push(o);
    return !match;
  });
  removed.forEach(o => addAudit_(data, 'DELETE', o, 'Entity Delete', o.entity, payload.reason));
  saveState_(data);
  return { success: true, message: `${removed.length} obligation(s) removed for ${payload.entity}.`, data: buildPayload_(data) };
}

function revertAuditEntry(auditId) {
  const data = getState_();
  const entry = (data.audit || []).find(a => a.id === auditId);
  if (!entry || entry.action !== 'UPDATE') return { success: false, message: 'Only update actions can be reverted.' };
  const item = data.obligations.find(o => o.id === entry.rowRef);
  if (!item) return { success: false, message: 'Original obligation no longer exists.' };
  const field = fieldFromLabel_(entry.fieldChanged);
  if (!field) return { success: false, message: 'This field cannot be reverted.' };
  const oldCurrent = item[field] || '';
  item[field] = entry.oldValue === '—' ? '' : entry.oldValue;
  item.lastUpdated = today_();
  addAudit_(data, 'REVERT', item, entry.fieldChanged, oldCurrent || '—', item[field] || '—');
  refreshStatuses_(data);
  saveState_(data);
  return { success: true, message: 'Change reverted successfully.', data: buildPayload_(data) };
}

function getObligationTypes(country) {
  const map = getCountryObligationTypes_();
  return map[country] || map._DEFAULT;
}

function exportCsvData() {
  const data = getState_();
  refreshStatuses_(data);
  const headers = ['Country','Entity','Obligation','Regulator','Frequency','Last Done','Next Due','Days Left','Status','Owner','Notes','Evidence','Last Updated','Completed By'];
  const rows = data.obligations.map(o => [o.country,o.entity,o.obligation,o.regulator,o.frequency,o.lastDone,o.nextDue,o.daysLeft,o.status,o.owner,o.notes,o.evidence,o.lastUpdated,o.completedBy]);
  return [headers].concat(rows).map(r => r.map(csvEscape_).join(',')).join('\n');
}
