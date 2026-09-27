/** Registration-only guidance; never apply new rules to existing-account login. */
export const PASSWORD_RULES = [
  { id: 'length', label: 'At least 12 characters', test: (value) => value.length >= 12 },
  { id: 'uppercase', label: 'One uppercase letter', test: (value) => /[A-Z]/.test(value) },
  { id: 'lowercase', label: 'One lowercase letter', test: (value) => /[a-z]/.test(value) },
  { id: 'number', label: 'One number', test: (value) => /[0-9]/.test(value) },
  { id: 'symbol', label: 'One symbol', test: (value) => /[^A-Za-z0-9\s]/.test(value) },
  { id: 'maximum', label: 'No more than 200 characters', test: (value) => value.length <= 200 },
];
export const normalizeEmail = (value) => value.trim().toLowerCase();
export const passwordsMatch = (password, confirmation) => Boolean(password) && password === confirmation;
export function validateRegistration(values) {
  const errors = {};
  if (!values.name.trim()) errors.name = 'Please enter your full name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(values.email))) errors.email = 'Please enter a valid email address.';
  if (!PASSWORD_RULES.every((rule) => rule.test(values.password))) errors.password = 'Please meet all the password requirements below.';
  if (!passwordsMatch(values.password, values.confirmPassword)) errors.confirmPassword = 'Enter the same password in both fields.';
  return errors;
}
