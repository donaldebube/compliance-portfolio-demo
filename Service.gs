// =============================================================================
// SERVICE.GS — State, calculations, dummy data and helpers
// =============================================================================

const STORE_KEY = 'COMPLIANCE_PORTFOLIO_DEMO_STATE_V2';
const TZ = Session.getScriptTimeZone() || 'Africa/Lagos';

function getState_() {
  const raw = PropertiesService.getScriptProperties().getProperty(STORE_KEY);
  if (!raw) return seedDemoData_(false);
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.obligations || !Array.isArray(parsed.obligations)) throw new Error('Bad state');
    return parsed;
  } catch (e) {
    return seedDemoData_(false);
  }
}

function saveState_(data) {
  PropertiesService.getScriptProperties().setProperty(STORE_KEY, JSON.stringify(data));
}

function seedDemoData_(force) {
  if (!force) {
    const raw = PropertiesService.getScriptProperties().getProperty(STORE_KEY);
    if (raw) return JSON.parse(raw);
  }
  const now = new Date();
  const d = offsetDate_;
  const obligations = [
    ['Nigeria','Atlas Payments Ltd','Annual Returns Filing','Corporate Affairs Registry','Annual', d(-410), d(2), 'Pending','Maya Okafor','Board pack is ready for review.','https://example.com/evidence/annual-returns',''],
    ['Nigeria','Atlas Payments Ltd','VAT Filing / Returns','Federal Tax Office','Monthly', d(-33), d(-3), 'Pending','Liam Carter','Awaiting final sales schedule.','',''],
    ['Nigeria','Atlas Digital Services','Data Protection Compliance Review','Data Protection Authority','Annual', d(-365), d(21), 'Pending','Ava Mensah','Privacy impact checklist in progress.','',''],
    ['Ghana','Atlas Ghana Ltd','PAYE / Payroll Tax','Revenue Authority','Monthly', d(-30), d(0), 'Pending','Noah Williams','Payroll report uploaded.','',''],
    ['Ghana','Atlas Ghana Ltd','AML/CFT Compliance Report','Financial Intelligence Centre','Quarterly', d(-92), d(9), 'Pending','Ife Bello','MLRO review pending.','',''],
    ['Kenya','Atlas Kenya Ltd','Business Permit Renewal','County Licensing Office','Annual', d(-366), d(45), 'Pending','Zara Stone','Permit renewal window opens soon.','',''],
    ['Kenya','Atlas Kenya Ltd','Corporate Income Tax','Revenue Authority','Annual', d(-340), d(75), 'Pending','Ethan Cole','Draft computation requested.','',''],
    ['South Africa','Atlas ZA Pty','POPIA Compliance Review','Information Regulator','Annual', d(-365), d(120), 'Pending','Maya Okafor','Policy update needed before review.','',''],
    ['South Africa','Atlas ZA Pty','VASP Registration Renewal','Financial Sector Authority','Annual', d(-365), d(-18), 'Overdue','Liam Carter','Regulatory response overdue.','',''],
    ['United Kingdom','Atlas UK Ltd','Confirmation Statement','Companies Registry','Annual', d(-350), d(31), 'Pending','Ava Mensah','Director details verified.','',''],
    ['United Kingdom','Atlas UK Ltd','Corporation Tax Return','Tax Authority','Annual', d(-330), d(88), 'Pending','Noah Williams','Working papers with finance.','',''],
    ['Canada','Atlas Canada Inc','Privacy Compliance Assessment','Privacy Commissioner','Annual', d(-365), d(14), 'Pending','Ife Bello','Vendor register under review.','',''],
    ['Canada','Atlas Canada Inc','GST / HST Returns','Revenue Agency','Quarterly', d(-92), d(6), 'Pending','Zara Stone','Need settlement export.','',''],
    ['Rwanda','Atlas Rwanda Ltd','Social Security Contributions','Social Security Board','Monthly', d(-28), d(19), 'Completed','Ethan Cole','Submitted successfully.','https://example.com/evidence/rssb','Demo User'],
    ['Dubai','Atlas MENA FZE','Economic Substance Notification','Free Zone Authority','Annual', d(-365), d(63), 'Pending','Maya Okafor','ESR questionnaire drafted.','','']
  ].map(r => normalizeObligation_({
    id: Utilities.getUuid(), country:r[0], entity:r[1], obligation:r[2], regulator:r[3], frequency:r[4],
    lastDone:r[5], nextDue:r[6], status:r[7], owner:r[8], notes:r[9], evidence:r[10], alertEmail:'demo-alerts@example.com', completedBy:r[11], lastUpdated:today_()
  }));
  const state = { obligations, audit: [] };
  obligations.slice(0,5).forEach(o => addAudit_(state, 'ADD', o, 'Demo Seed', '', o.obligation));
  refreshStatuses_(state);
  saveState_(state);
  return state;
}

function buildPayload_(data) {
  const countries = [...new Set(data.obligations.map(o => o.country))].sort();
  const entities = {};
  const obligations = {};
  countries.forEach(c => entities[c] = []);
  data.obligations.forEach(o => {
    if (!entities[o.country].includes(o.entity)) entities[o.country].push(o.entity);
    const key = `${o.country}||${o.entity}`;
    if (!obligations[key]) obligations[key] = [];
    obligations[key].push(o);
  });
  Object.keys(entities).forEach(k => entities[k].sort());
  Object.keys(obligations).forEach(k => obligations[k].sort((a,b) => a.nextDue.localeCompare(b.nextDue)));
  return { obligations: data.obligations.slice().sort((a,b) => a.nextDue.localeCompare(b.nextDue)), countries, entities, byEntity: obligations, audit: getAuditLog(), notifications: buildNotifications_(data), dashboard: buildDashboard_(data), obligationTypes: getCountryObligationTypes_() };
}

function buildDashboard_(data) {
  const rows = data.obligations || [];
  const total = rows.length;
  const overdue = rows.filter(o => o.status === 'Overdue').length;
  const dueToday = rows.filter(o => Number(o.daysLeft) === 0 && o.status !== 'Completed').length;
  const dueSoon = rows.filter(o => Number(o.daysLeft) >= 0 && Number(o.daysLeft) <= 30 && o.status !== 'Completed').length;
  const completed = rows.filter(o => o.status === 'Completed').length;
  const pending = rows.filter(o => o.status === 'Pending').length;
  const completionRate = total ? Math.round((completed / total) * 100) : 0;
  const riskScore = Math.min(100, Math.round((overdue * 18) + (dueToday * 12) + (dueSoon * 3) + ((100 - completionRate) * .35)));
  const riskLevel = riskScore >= 75 ? 'Critical' : riskScore >= 50 ? 'High' : riskScore >= 25 ? 'Moderate' : 'Low';
  const countrySummary = {};
  rows.forEach(o => {
    if (!countrySummary[o.country]) countrySummary[o.country] = { country:o.country,total:0,overdue:0,dueSoon:0,completed:0,pending:0 };
    countrySummary[o.country].total++;
    if (o.status === 'Overdue') countrySummary[o.country].overdue++;
    if (Number(o.daysLeft) >= 0 && Number(o.daysLeft) <= 30 && o.status !== 'Completed') countrySummary[o.country].dueSoon++;
    if (o.status === 'Completed') countrySummary[o.country].completed++;
    if (o.status === 'Pending') countrySummary[o.country].pending++;
  });
  const ownerSummary = {};
  rows.forEach(o => {
    const k = o.owner || 'Unassigned';
    if (!ownerSummary[k]) ownerSummary[k] = { owner:k,total:0,overdue:0,dueSoon:0,completed:0 };
    ownerSummary[k].total++;
    if (o.status === 'Overdue') ownerSummary[k].overdue++;
    if (Number(o.daysLeft) >= 0 && Number(o.daysLeft) <= 30 && o.status !== 'Completed') ownerSummary[k].dueSoon++;
    if (o.status === 'Completed') ownerSummary[k].completed++;
  });
  return { total, overdue, dueToday, dueSoon, completed, pending, completionRate, riskScore, riskLevel, countrySummary:Object.values(countrySummary), ownerSummary:Object.values(ownerSummary).sort((a,b)=>b.total-a.total) };
}

function buildNotifications_(data) {
  const rows = data.obligations || [];
  return rows.filter(o => o.status !== 'Completed').map(o => {
    const days = Number(o.daysLeft);
    let severity = 'low', type = 'horizon', message = `${o.obligation} is due in ${days} days`;
    if (o.status === 'Overdue') { severity = 'critical'; type = 'overdue'; message = `${o.obligation} is ${Math.abs(days)} day(s) overdue`; }
    else if (days === 0) { severity = 'critical'; type = 'today'; message = `${o.obligation} is due today`; }
    else if (days <= 3) { severity = 'urgent'; type = 'urgent'; }
    else if (days <= 7) { severity = 'warning'; type = 'week'; }
    else if (days <= 30) { severity = 'info'; type = 'month'; }
    else if (days > 120) return null;
    return { id:o.id, type, severity, country:o.country, entity:o.entity, obligation:o.obligation, owner:o.owner, dueDate:o.nextDue, daysLeft:days, message };
  }).filter(Boolean).sort((a,b) => {
    const order = {critical:0, urgent:1, warning:2, info:3, low:4};
    return order[a.severity] - order[b.severity] || a.daysLeft - b.daysLeft;
  });
}

function refreshStatuses_(data) {
  (data.obligations || []).forEach(o => {
    o.daysLeft = daysBetween_(today_(), o.nextDue);
    if (o.status !== 'Completed' && o.status !== 'N/A') {
      o.status = Number(o.daysLeft) < 0 ? 'Overdue' : 'Pending';
    }
  });
}

function normalizeObligation_(o) {
  o.lastDone = normalizeDate_(o.lastDone);
  o.nextDue = normalizeDate_(o.nextDue);
  o.lastUpdated = normalizeDate_(o.lastUpdated || today_());
  o.daysLeft = daysBetween_(today_(), o.nextDue);
  return o;
}

function addAudit_(data, action, item, fieldChanged, oldValue, newValue) {
  if (!data.audit) data.audit = [];
  data.audit.push({ id: Utilities.getUuid(), timestamp: Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy HH:mm'), user: 'Public Demo User', action, country:item.country, entity:item.entity, obligation:item.obligation, fieldChanged, oldValue:String(oldValue || ''), newValue:String(newValue || ''), rowRef:item.id });
  if (data.audit.length > 250) data.audit = data.audit.slice(data.audit.length - 250);
}

function getCountryObligationTypes_() {
  return {
    Nigeria:['Annual Returns Filing','Corporate Income Tax','VAT Filing / Returns','PAYE / Payroll Tax','Withholding Tax Returns','AML/CFT Compliance Report','Data Protection Compliance Review','Beneficial Ownership Register'],
    Ghana:['Annual Returns Filing','Corporate Income Tax','VAT Filing / Returns','PAYE / Payroll Tax','AML/CFT Compliance Report','Business Operating Permit Renewal','Data Protection Registration'],
    Kenya:['Annual Returns Filing','Corporate Income Tax','VAT Filing / Returns','PAYE / Payroll Tax','Business Permit Renewal','Data Protection Registration','AML/CFT Compliance Report'],
    'South Africa':['Annual Returns Filing','Corporate Income Tax','VAT Filing / Returns','PAYE / Payroll Tax','POPIA Compliance Review','VASP Registration Renewal','Statutory Audit'],
    'United Kingdom':['Confirmation Statement','Corporation Tax Return','VAT Filing / Returns','PAYE / Payroll','FCA Regulatory Return','UK GDPR Compliance Review'],
    Canada:['Annual Return','Corporate Income Tax','GST / HST Returns','Payroll Remittance','AML/CFT Compliance Report','Privacy Compliance Assessment'],
    Rwanda:['Annual Returns Filing','Corporate Income Tax','VAT Filing / Returns','PAYE / Payroll Tax','Social Security Contributions','AML/CFT Compliance Report'],
    Dubai:['Corporate Tax Return','VAT Filing / Returns','AML/CFT Compliance Report','VASP Licensing Renewal','UBO Register Filing','Economic Substance Notification'],
    _DEFAULT:['Annual Returns Filing','Corporate Tax Filing','VAT Filing / Returns','Payroll Tax','AML/CFT Compliance Report','Data Protection Compliance','Business Licence Renewal','Statutory Audit']
  };
}

function sameKey_(a,b){ return a.country===b.country && a.entity===b.entity && a.obligation===b.obligation; }
function today_(){ return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function offsetDate_(days){ const d = new Date(); d.setDate(d.getDate()+days); return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }
function normalizeDate_(v){ if(!v) return ''; if(v instanceof Date) return Utilities.formatDate(v,TZ,'yyyy-MM-dd'); return String(v).slice(0,10); }
function daysBetween_(a,b){ if(!b) return ''; const d1 = new Date(a+'T00:00:00'); const d2 = new Date(b+'T00:00:00'); return Math.round((d2-d1)/86400000); }
function validatePayload_(payload, fields){ if(!payload) throw new Error('Missing payload'); fields.forEach(f => { if(payload[f] === undefined || payload[f] === null || payload[f] === '') throw new Error(`Missing required field: ${f}`); }); }
function csvEscape_(v){ const s=String(v==null?'':v); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; }
function label_(field){ return ({country:'Country',entity:'Entity',obligation:'Obligation',regulator:'Regulator',frequency:'Frequency',lastDone:'Last Completed Date',nextDue:'Next Due Date',status:'Status',owner:'Owner',notes:'Notes',evidence:'Evidence Link',completedBy:'Completed By'})[field] || field; }
function fieldFromLabel_(label){ const map={}; ['country','entity','obligation','regulator','frequency','lastDone','nextDue','status','owner','notes','evidence','completedBy'].forEach(f=>map[label_(f)]=f); return map[label]; }
