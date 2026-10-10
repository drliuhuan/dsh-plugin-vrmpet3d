/**
 * One environment variable, under the name this project has now and the name it had before the 2026-10-12 rename.
 *
 * `VRMPET3D_<NAME>` first, then `PET3D_<NAME>`. The old name is kept for a while because the operator's shell and
 * their DSH environment may still set it (`PET3D_DESKTOP_RUNTIME`, `PET3D_DSH_ASAR`, `PET3D_BROWSER`), and a
 * rename that silently ignored them would look like "the runtime stopped being found" rather than like a variable
 * that needs renaming. An empty string counts as unset, so a launcher that blanked the new name does not shadow a
 * value the old one still carries.
 *
 * Host-side only: nothing here is served to a browser (`lib/` ships it, `WINDOW_SOURCES` does not).
 *
 * @param {string} name the part after the prefix, e.g. `DESKTOP_RUNTIME`
 * @returns {string} the value, or '' when neither name is set
 */
export function envVar(name) {
  const current = process.env[`VRMPET3D_${name}`];
  if (typeof current === 'string' && current !== '') return current;
  const legacy = process.env[`PET3D_${name}`];
  return typeof legacy === 'string' ? legacy : '';
}
