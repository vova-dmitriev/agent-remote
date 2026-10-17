// Reject exactly ASCII C0 controls and DEL in native paths and display metadata.
// eslint-disable-next-line no-control-regex
export const ASCII_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
