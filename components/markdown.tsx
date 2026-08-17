import ReactMarkdown from 'react-markdown';

/**
 * Comment bodies are guest-writable, so this is a security boundary.
 * react-markdown does not render raw HTML unless rehype-raw is added — it is
 * deliberately absent. allowedElements further restricts output to the
 * formatting the composer actually offers.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-1 text-sm [&_em]:italic [&_li]:ml-4 [&_li]:list-disc [&_strong]:font-semibold">
      <ReactMarkdown
        allowedElements={['p', 'strong', 'em', 'ul', 'ol', 'li', 'br', 'code']}
        unwrapDisallowed
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
