import Link from 'next/link'

// Offline LAN deployment: there is no outbound email, so there is no
// self-service reset link. An admin resets the password (Slice 3) and the
// user is prompted to choose a new one at next sign-in (must_change_password).
export function ForgotPasswordNotice({ loginHref = '/login' }) {
  return (
    <>
      <h1 className="text-xl font-bold text-text-primary mb-2">Forgot your password?</h1>
      <p className="text-sm text-text-secondary leading-relaxed">
        This system runs offline inside the exam network, so we can&apos;t email
        you a reset link. Ask your <strong>Exam Officer / administrator</strong> to
        reset your password — you&apos;ll be given a temporary one and prompted to
        set a new password the next time you sign in.
      </p>
      <Link
        href={loginHref}
        className="inline-block mt-6 text-sm text-primary hover:text-primary-hover underline underline-offset-2"
      >
        Back to sign in
      </Link>
    </>
  )
}
