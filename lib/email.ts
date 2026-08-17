import { Resend } from 'resend';

/**
 * Email is a good-to-have, so a failure here must never fail the share itself.
 * Every path returns a boolean rather than throwing, and a missing API key is
 * treated as "not configured" rather than an error.
 */
export async function sendShareEmail(input: {
  to: string;
  inviteeName: string;
  ownerName: string;
  filename: string;
  url: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('RESEND_API_KEY not set; skipping share email');
    return false;
  }

  try {
    await new Resend(apiKey).emails.send({
      // Resend's sandbox sender works without domain verification.
      from: 'PDF Intelligence <onboarding@resend.dev>',
      to: input.to,
      subject: `${input.ownerName} shared "${input.filename}" with you`,
      text: [
        `Hi ${input.inviteeName},`,
        '',
        `${input.ownerName} shared a PDF with you: ${input.filename}`,
        '',
        `View it here (no account needed): ${input.url}`,
        '',
        'You can read the document, see its AI summary, ask questions about it, and leave comments.',
      ].join('\n'),
    });
    return true;
  } catch (error) {
    console.error('share email failed', error);
    return false;
  }
}
