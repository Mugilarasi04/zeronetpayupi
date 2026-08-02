// Loose VPA validation. NPCI doesn't publish a strict regex; in
// practice handles include letters, digits, dots, dashes, and
// underscores on both sides of the `@`. We keep this permissive on
// purpose — UPI apps verify the VPA against the central mapper at
// payment time, which is the real source of truth.
const UPI_REGEX = /^[a-zA-Z0-9.\-_]{2,}@[a-zA-Z0-9.\-_]{2,}$/;

function isValidUpi(s) {
  return typeof s === 'string' && UPI_REGEX.test(s.trim());
}

module.exports = { UPI_REGEX, isValidUpi };
