import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { loginSchema } from '@/lib/validation';
import { normalizeEmail, verifyPassword } from '@/lib/password';

/**
 * Auth.js session wiring. Credentials provider only, with JWT sessions (which
 * Credentials requires). Password hashing lives in lib/password.ts and is ours
 * rather than a vendor's, so the security-critical part is auditable here.
 */

/**
 * A structurally valid bcrypt hash that no password matches. Compared against
 * when no user exists, so response time does not reveal whether an account is
 * registered.
 */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.6Vv6P0Zm0BvVFzQNa5f0Vp1qbHRLZ2u';

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;

        const email = normalizeEmail(parsed.data.email);
        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

        const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !ok) return null;

        return { id: user.id, name: user.name, email: user.email };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid) session.user.id = token.uid as string;
      return session;
    },
  },
});
