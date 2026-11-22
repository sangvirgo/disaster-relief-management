const reporterPhonePattern = /^\+?[0-9]{8,15}$/u;

export function requestSearchTerms(value: string | undefined): {
  trackingCodePattern: string | null;
  reporterPhone: string | null;
} {
  const query = value?.trim() ?? '';
  const phone = query.replace(/[ ()-]/gu, '');
  const escapedCode = query.toUpperCase().replace(/[!%_]/gu, '!$&');

  return {
    trackingCodePattern: escapedCode ? `%${escapedCode}%` : null,
    reporterPhone: reporterPhonePattern.test(phone) ? phone : null,
  };
}
