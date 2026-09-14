export type SignOutActionState = { errors?: { form?: string } };

export async function adminSignOutAction(): Promise<SignOutActionState> {
  return {};
}
