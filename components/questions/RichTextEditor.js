'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Mathematics from '@tiptap/extension-mathematics'
import { Bold, Italic, Code, List, ListOrdered, Sigma } from 'lucide-react'

export function RichTextEditor({
  value = '',
  onChange,
  onBlur,
  placeholder = 'Type your question here…',
  error,
  disabled = false,
}) {
  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Placeholder.configure({ placeholder }),
      Mathematics,
    ],
    content: value,
    onUpdate({ editor }) {
      const html = editor.getText().trim() ? editor.getHTML() : ''
      onChange?.(html)
    },
    onBlur({ event }) {
      onBlur?.(event)
    },
  })

  const ToolbarButton = ({ onClick, active, title, children }) => (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); onClick() }}
      title={title}
      className={[
        'flex size-7 items-center justify-center rounded text-sm transition-colors',
        active
          ? 'bg-primary text-white'
          : 'text-text-secondary hover:bg-page hover:text-text-primary',
      ].join(' ')}
    >
      {children}
    </button>
  )

  function insertInlineMath() {
    editor?.chain().focus().insertContent('$x$').run()
  }

  function insertBlockMath() {
    editor?.chain().focus().insertContent('\n$$E = mc^2$$\n').run()
  }

  return (
    <div
      className={[
        'rounded-lg border bg-surface overflow-hidden transition-colors',
        error
          ? 'border-danger focus-within:ring-2 focus-within:ring-danger/20'
          : 'border-border focus-within:border-border-focus focus-within:ring-2 focus-within:ring-primary/15',
        disabled ? 'opacity-60 cursor-not-allowed' : '',
      ].join(' ')}
    >
      {!disabled && (
        <div className="flex items-center gap-0.5 border-b border-border px-2 py-1.5 flex-wrap">
          <ToolbarButton
            onClick={() => editor?.chain().focus().toggleBold().run()}
            active={editor?.isActive('bold')}
            title="Bold"
          >
            <Bold className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            active={editor?.isActive('italic')}
            title="Italic"
          >
            <Italic className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor?.chain().focus().toggleCode().run()}
            active={editor?.isActive('code')}
            title="Inline code"
          >
            <Code className="size-3.5" />
          </ToolbarButton>
          <div className="w-px h-4 bg-border mx-1" />
          <ToolbarButton
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            active={editor?.isActive('bulletList')}
            title="Bullet list"
          >
            <List className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            active={editor?.isActive('orderedList')}
            title="Numbered list"
          >
            <ListOrdered className="size-3.5" />
          </ToolbarButton>
          <div className="w-px h-4 bg-border mx-1" />
          {/* Math insert buttons */}
          <ToolbarButton onClick={insertInlineMath} title="Insert inline math ($x$)">
            <Sigma className="size-3.5" />
          </ToolbarButton>
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); insertBlockMath() }}
            title="Insert block math ($$...$$)"
            className="flex items-center gap-1 h-7 px-2 rounded text-xs font-medium text-text-secondary hover:bg-page hover:text-text-primary transition-colors"
          >
            <Sigma className="size-3" />∑
          </button>
          <span className="ml-auto text-xs text-text-muted select-none">
            Use <code className="bg-slate-100 px-1 rounded text-[10px]">$x^2$</code> inline · <code className="bg-slate-100 px-1 rounded text-[10px]">$$E=mc^2$$</code> block
          </span>
        </div>
      )}

      <EditorContent editor={editor} className="tiptap" />
    </div>
  )
}
