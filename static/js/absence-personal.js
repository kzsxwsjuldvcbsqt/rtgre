(function (global) {
  function validName(value, maximum) {
    if (typeof value !== "string" || [...value].length > maximum) return false;
    return /^\p{L}[\p{L}\p{M}]*(?:[ '’ʼ.\-‐‑]+\p{L}[\p{L}\p{M}]*)*\.?$/u.test(
      value.normalize("NFC"),
    );
  }
  function errors(values, config, civilDate) {
    const result = {};
    for (const field of ["lastName", "firstName"]) {
      if (!validName(values[field], config.max_name_length))
        result[field] = "sheet_invalid_name";
    }
    if (
      typeof values.reason !== "string" ||
      !values.reason.trim() ||
      values.reason.length > config.max_text_length ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(values.reason)
    )
      result.reason = "sheet_invalid_reason";
    if (!civilDate(values.date)) result.date = "sheet_signing_date_invalid";
    return result;
  }
  function validate(values, config, civilDate) {
    const invalid = Object.values(errors(values, config, civilDate));
    if (invalid.length) throw new Error(invalid[0]);
    return {
      ...values,
      lastName: values.lastName.normalize("NFC"),
      firstName: values.firstName.normalize("NFC"),
    };
  }
  const api = { validName, errors, validate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.AbsencePersonal = api;
})(globalThis);
