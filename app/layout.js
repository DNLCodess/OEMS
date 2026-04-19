import { Plus_Jakarta_Sans } from 'next/font/google'
import { Geist_Mono } from 'next/font/google'
import { Toaster } from 'sonner'
import './globals.css'

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
})

export const metadata = {
  title: {
    template: '%s — OEMS',
    default: 'OEMS — Online Examination Management System',
  },
  description: 'Computer-Based Test platform for Nigerian universities.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${geistMono.variable} h-full overflow-hidden`}>
      <body className="h-full overflow-hidden">
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              fontFamily: 'var(--font-jakarta)',
              fontSize: '14px',
            },
          }}
        />
      </body>
    </html>
  )
}
