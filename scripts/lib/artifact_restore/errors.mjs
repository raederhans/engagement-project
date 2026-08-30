export class ArtifactRestoreError extends Error {
  constructor(code, message, details = undefined, options = undefined) {
    super(message, options);
    this.name = 'ArtifactRestoreError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
export function restoreError(code, message, details = undefined, options = undefined) {
  return new ArtifactRestoreError(code, message, details, options);
}
