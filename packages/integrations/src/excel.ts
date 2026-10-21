import ExcelJS from 'exceljs';

export interface ContactExport {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  emails: { email: string; label?: string | null }[];
  phones: { number: string; label?: string | null }[];
  websites: string[];
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  socialLinks: { url: string; label?: string | null }[];
  notes?: string | null;
}

export function safeCell(value: string | null | undefined) {
  if (value == null) return '';
  // Retain literal text even when a receiving spreadsheet or CSV tool would interpret a formula.
  return /^[\s\u0000-\u001f]*[=+@-]/u.test(value) ? `'${value}` : value;
}

export async function createContactsWorkbook(contacts: ContactExport[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FileForge AI';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Contacts', { views: [{ state: 'frozen', ySplit: 1 }] });
  const columns = [
    ['Full name', 'fullName', 26],
    ['Company', 'company', 26],
    ['Job title', 'jobTitle', 24],
    ['Department', 'department', 22],
    ['Email addresses', 'emails', 38],
    ['Phone numbers', 'phones', 30],
    ['Websites', 'websites', 35],
    ['Address', 'address', 38],
    ['City', 'city', 20],
    ['State', 'state', 20],
    ['Country', 'country', 20],
    ['Postal code', 'postalCode', 18],
    ['Social links', 'socialLinks', 38],
    ['Notes', 'notes', 45],
    ['First name', 'firstName', 22],
    ['Last name', 'lastName', 22],
  ] as const;
  sheet.columns = columns.map(([header, key, width]) => ({ header, key, width }));
  sheet.autoFilter = { from: 'A1', to: 'P1' };
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
  for (const contact of contacts) {
    const data = {
      ...contact,
      emails: contact.emails.map((value) => value.email).join('\n'),
      phones: contact.phones.map((value) => value.number).join('\n'),
      websites: contact.websites.join('\n'),
      socialLinks: contact.socialLinks.map((value) => value.url).join('\n'),
    };
    const row = sheet.addRow(
      Object.fromEntries(columns.map(([, key]) => [key, safeCell(data[key])])),
    );
    row.alignment = { vertical: 'top', wrapText: true };
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
