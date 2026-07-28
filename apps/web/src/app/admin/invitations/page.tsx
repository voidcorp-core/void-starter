import { listInvitationsForAdmin, requireRole } from '@repo/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui';
import { InviteForm } from './InviteForm';

/**
 * Invitation administration for an `invite_only` project (ADR 63).
 *
 * Present only in a project generated with `auth.access_mode: invite_only`; the
 * factory prunes this route otherwise. Reads through the service layer, never
 * the repository, per the layering rule in docs/PATTERNS.md.
 */
export default async function InvitationsPage() {
  await requireRole('admin');
  const invitations = await listInvitationsForAdmin();

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-16">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Invitations</h1>
        <p className="text-muted-foreground">
          This application is invite-only. An address can only create an account while it holds a
          pending invitation.
        </p>
      </header>

      <InviteForm />

      <Card>
        <CardHeader>
          <CardTitle>Issued ({invitations.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {invitations.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No invitation issued yet. Only the bootstrap administrator can sign in.
            </p>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="border-border border-b">
                  <th className="py-2">Address</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Expires</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => (
                  <tr key={invitation.id} className="border-border border-b">
                    <td className="py-2">{invitation.email}</td>
                    <td className="py-2">{invitation.state}</td>
                    <td className="py-2 text-muted-foreground">
                      {invitation.expiresAt.toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
