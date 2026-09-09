export function Header({
  admin,
  title,
}: {
  admin: { email: string | null; role: string };
  title: string;
}) {
  const initial = (admin.email ?? 'staff').charAt(0).toUpperCase();

  return (
    <header className="wc-admin__header">
      <h1 className="wc-admin__title">{title}</h1>
      <div className="wc-admin__identity">
        <div className="wc-admin__identity-text">
          <span className="wc-admin__email">{admin.email ?? 'staff'}</span>
          <span className="wc-admin__role">{admin.role}</span>
        </div>
        <span className="wc-admin__avatar">{initial}</span>
      </div>
    </header>
  );
}
