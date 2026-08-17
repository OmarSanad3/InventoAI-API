/**
 * What created a `User` row — display and analytics only, never a permission
 * check. A `local` account that later signs in with Google keeps `local` and
 * gains a `googleId`; a `google` account that sets a password through the OTP
 * flow keeps `google` and gains a hash. The question "can this account use a
 * password" is answered by `password IS NOT NULL`, not by this column.
 */
export enum AuthProvider {
  Local = 'local',
  Google = 'google',
}
