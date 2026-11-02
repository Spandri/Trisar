export const toLocalDateValue = (input = new Date()) => {
  const date = input instanceof Date ? input : new Date(input);
  const timezoneOffsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 10);
};
