import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { Badge } from '@/components/ui/Badge'
import { ArchiveButton } from '@/components/questions/ArchiveButton'
import { Pencil } from 'lucide-react'

function stripHtml(html) {
  return html?.replace(/<[^>]+>/g, '') ?? ''
}

export function QuestionCard({ question }) {
  const bodyText = stripHtml(question.body)
  const preview = bodyText.length > 120 ? bodyText.slice(0, 120) + '…' : bodyText
  const timeAgo = formatDistanceToNow(new Date(question.created_at), { addSuffix: true })

  return (
    <article className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-3 hover:border-border-focus transition-colors">
      {/* Badges row */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant={question.type} />
        <Badge variant={question.difficulty} />
        {question.courses && (
          <span className="font-mono text-xs font-medium text-text-secondary bg-page border border-border rounded px-1.5 py-0.5">
            {question.courses.course_code}
          </span>
        )}
      </div>

      {/* Question body preview */}
      <p className="text-sm text-text-primary leading-relaxed line-clamp-3 flex-1">
        {preview || <span className="text-text-muted italic">No question text yet</span>}
      </p>

      {/* Tags */}
      {question.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {question.tags.slice(0, 4).map(tag => (
            <span key={tag} className="text-xs text-text-muted bg-page border border-border rounded px-1.5 py-0.5">
              {tag}
            </span>
          ))}
          {question.tags.length > 4 && (
            <span className="text-xs text-text-muted">+{question.tags.length - 4} more</span>
          )}
        </div>
      )}

      {/* Footer: metadata + actions */}
      <div className="flex items-center justify-between pt-1 border-t border-border">
        <span className="text-xs text-text-muted">{timeAgo}</span>
        <div className="flex items-center gap-1">
          <Link
            href={`/lecturer/questions/${question.id}/edit`}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-text-secondary hover:bg-page hover:text-text-primary transition-colors"
          >
            <Pencil className="size-3" />
            Edit
          </Link>
          <ArchiveButton questionId={question.id} />
        </div>
      </div>
    </article>
  )
}
