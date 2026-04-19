'use server'

import { createAdminClient } from '@/lib/supabase/admin'

function devOnly() {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('Dev-only action called in production.')
  }
}

// ─── Bootstrap super admin ───────────────────────────────────────────────────

export async function createSuperAdmin(_prevState, formData) {
  if (process.env.NODE_ENV !== 'development') {
    return { error: 'Only available in development.' }
  }

  const email     = formData.get('email')?.trim()
  const password  = formData.get('password')?.trim()
  const full_name = formData.get('full_name')?.trim()

  if (!email || !password || !full_name) {
    return { error: 'All fields are required.' }
  }
  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters.' }
  }

  const admin = createAdminClient()

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, role: 'super_admin' },
  })

  if (authError) return { error: authError.message }

  const userId = authData.user?.id
  if (!userId) return { error: 'User created but ID missing — check Supabase dashboard.' }

  return { success: true, email }
}

// ─── Seed full demo dataset ───────────────────────────────────────────────────

export async function seedDemoData() {
  devOnly()
  const admin = createAdminClient()

  // ── 1. University ──────────────────────────────────────────────────────────
  const { data: uni, error: uniErr } = await admin
    .from('universities')
    .upsert({ name: 'Demo University of Nigeria', subdomain: 'dun' }, { onConflict: 'subdomain' })
    .select('id')
    .single()

  if (uniErr) return { error: `University: ${uniErr.message}` }
  const uniId = uni.id

  // ── 2. Faculties ───────────────────────────────────────────────────────────
  const { data: faculties } = await admin
    .from('faculties')
    .upsert([
      { university_id: uniId, name: 'Faculty of Computing & Information Sciences' },
      { university_id: uniId, name: 'Faculty of Engineering' },
    ], { onConflict: 'university_id,name' })
    .select('id, name')

  const compFacId = faculties?.find(f => f.name.includes('Computing'))?.id
  const engFacId  = faculties?.find(f => f.name.includes('Engineering'))?.id

  // ── 3. Departments ─────────────────────────────────────────────────────────
  const { data: depts } = await admin
    .from('departments')
    .upsert([
      { university_id: uniId, faculty_id: compFacId, name: 'Computer Science' },
      { university_id: uniId, faculty_id: compFacId, name: 'Information Technology' },
      { university_id: uniId, faculty_id: engFacId,  name: 'Electrical Engineering' },
    ], { onConflict: 'faculty_id,name' })
    .select('id, name')

  const csDeptId = depts?.find(d => d.name === 'Computer Science')?.id

  // ── 4. Courses ─────────────────────────────────────────────────────────────
  const { data: courses } = await admin
    .from('courses')
    .upsert([
      { university_id: uniId, department_id: csDeptId, course_code: 'CSC 301', course_title: 'Data Structures & Algorithms', credit_units: 3, level: '300', semester: 'first' },
      { university_id: uniId, department_id: csDeptId, course_code: 'CSC 401', course_title: 'Operating Systems', credit_units: 3, level: '400', semester: 'second' },
    ], { onConflict: 'university_id,course_code' })
    .select('id, course_code')

  const csc301Id = courses?.find(c => c.course_code === 'CSC 301')?.id

  // ── 5. Auth users (idempotent via email) ───────────────────────────────────
  async function upsertUser(email, password, meta) {
    // Check if user already exists
    const { data: existing } = await admin.auth.admin.listUsers()
    const found = existing?.users?.find(u => u.email === email)
    if (found) return found.id

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: meta,
    })
    if (error) throw new Error(`${email}: ${error.message}`)
    return data.user.id
  }

  let adminId, lecturerId, studentId

  try {
    adminId    = await upsertUser('admin@dun.edu.ng',    'Demo1234!', { full_name: 'Dr. Fatima Bello',     role: 'school_admin', university_id: uniId })
    lecturerId = await upsertUser('lecturer@dun.edu.ng', 'Demo1234!', { full_name: 'Dr. Chukwudi Okafor',  role: 'lecturer',     university_id: uniId })
    studentId  = await upsertUser('student@dun.edu.ng',  'Demo1234!', { full_name: 'Amara Nwosu',           role: 'student',      university_id: uniId, matric_number: 'CSC/2021/001', level: '300' })
  } catch (e) {
    return { error: e.message }
  }

  // Update department for student and lecturer
  await admin.from('users').update({ department_id: csDeptId, faculty_id: compFacId })
    .in('id', [lecturerId, studentId])

  // ── 6. Questions ───────────────────────────────────────────────────────────
  const { data: questions } = await admin
    .from('question_bank')
    .upsert([
      {
        university_id: uniId, created_by: lecturerId, course_id: csc301Id,
        type: 'mcq', difficulty: 'easy', tags: ['arrays', 'basics'],
        body: '<p>What is the time complexity of accessing an element in an array by index?</p>',
        options: [{ id: 'a', text: 'O(1)' }, { id: 'b', text: 'O(n)' }, { id: 'c', text: 'O(log n)' }, { id: 'd', text: 'O(n²)' }],
        correct_answer: 'a',
        explanation: 'Array access by index is constant time — the memory address is computed directly.',
      },
      {
        university_id: uniId, created_by: lecturerId, course_id: csc301Id,
        type: 'mcq', difficulty: 'medium', tags: ['stacks', 'queues'],
        body: '<p>Which data structure follows the LIFO (Last In, First Out) principle?</p>',
        options: [{ id: 'a', text: 'Queue' }, { id: 'b', text: 'Stack' }, { id: 'c', text: 'Linked List' }, { id: 'd', text: 'Tree' }],
        correct_answer: 'b',
        explanation: 'A Stack is LIFO — the last element pushed is the first one popped.',
      },
      {
        university_id: uniId, created_by: lecturerId, course_id: csc301Id,
        type: 'true_false', difficulty: 'easy', tags: ['basics'],
        body: '<p>A Binary Search Tree (BST) always has a time complexity of O(log n) for search operations.</p>',
        options: [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }],
        correct_answer: 'false',
        explanation: 'In the worst case (degenerate tree), BST search is O(n).',
      },
      {
        university_id: uniId, created_by: lecturerId, course_id: csc301Id,
        type: 'multi_select', difficulty: 'medium', tags: ['sorting'],
        body: '<p>Which of the following sorting algorithms have O(n log n) average-case complexity? <em>(Select all that apply)</em></p>',
        options: [{ id: 'a', text: 'Bubble Sort' }, { id: 'b', text: 'Merge Sort' }, { id: 'c', text: 'Quick Sort' }, { id: 'd', text: 'Insertion Sort' }],
        correct_answer: ['b', 'c'],
        explanation: 'Merge Sort is always O(n log n). Quick Sort is O(n log n) on average but O(n²) worst case.',
      },
      {
        university_id: uniId, created_by: lecturerId, course_id: csc301Id,
        type: 'fill_blank', difficulty: 'medium', tags: ['trees'],
        body: '<p>The maximum number of nodes at level <em>l</em> of a binary tree is ___.</p>',
        options: null,
        correct_answer: '2^l',
        explanation: 'At level 0 (root) there is 1 node; each level doubles the maximum count.',
      },
      {
        university_id: uniId, created_by: lecturerId, course_id: csc301Id,
        type: 'short_answer', difficulty: 'hard', tags: ['complexity'],
        body: '<p>Explain the difference between best-case, average-case, and worst-case time complexity. Give an example using Linear Search.</p>',
        options: null,
        correct_answer: null,
        explanation: null,
      },
    ], { onConflict: 'id' })
    .select('id')

  if (!questions?.length) return { error: 'Failed to create questions.' }

  // ── 7. Exam ────────────────────────────────────────────────────────────────
  const now   = new Date()
  const start = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000) // 2 days ago
  const end   = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000) // 1 day ago

  const { data: exam } = await admin
    .from('exams')
    .upsert({
      university_id: uniId, created_by: lecturerId, course_id: csc301Id,
      title: 'CSC 301 — First C.A. Test',
      instructions: '<p>Answer all questions. No electronic devices allowed. Time: 45 minutes.</p>',
      duration_minutes: 45,
      start_at: start.toISOString(),
      end_at:   end.toISOString(),
      academic_session: '2024/2025',
      semester: 'first',
      exam_type: 'ca',
      status: 'closed',
      pass_mark: 50,
      randomise_questions: false,
      randomise_options:   false,
    }, { onConflict: 'id' })
    .select('id')
    .single()

  if (!exam) return { error: 'Failed to create exam.' }
  const examId = exam.id

  // ── 8. Exam questions ──────────────────────────────────────────────────────
  const examQRows = questions.map((q, i) => ({
    exam_id: examId, question_id: q.id,
    order_index: i,
    marks: i < 4 ? 2 : (i === 4 ? 3 : 5), // Q1-4: 2 marks, Q5: 3 marks, Q6: 5 marks
  }))

  await admin.from('exam_questions')
    .upsert(examQRows, { onConflict: 'exam_id,question_id' })

  // ── 9. Attempt (student has already submitted) ─────────────────────────────
  const submittedAt = new Date(end.getTime() - 30 * 60 * 1000) // 30 min before end

  const { data: attempt } = await admin
    .from('attempts')
    .upsert({
      exam_id: examId, student_id: studentId,
      started_at: new Date(submittedAt.getTime() - 40 * 60 * 1000).toISOString(),
      submitted_at: submittedAt.toISOString(),
      status: 'graded',
      total_score: 11,
    }, { onConflict: 'id' })
    .select('id')
    .single()

  if (!attempt) return { error: 'Failed to create attempt.' }
  const attemptId = attempt.id

  // ── 10. Responses ──────────────────────────────────────────────────────────
  const responseRows = [
    { attempt_id: attemptId, question_id: questions[0].id, student_answer: '"a"',   is_correct: true,  marks_awarded: 2 },
    { attempt_id: attemptId, question_id: questions[1].id, student_answer: '"b"',   is_correct: true,  marks_awarded: 2 },
    { attempt_id: attemptId, question_id: questions[2].id, student_answer: '"true"', is_correct: false, marks_awarded: 0 },
    { attempt_id: attemptId, question_id: questions[3].id, student_answer: '["b","c"]', is_correct: true, marks_awarded: 2 },
    { attempt_id: attemptId, question_id: questions[4].id, student_answer: '"2^l"', is_correct: true,  marks_awarded: 3 },
    { attempt_id: attemptId, question_id: questions[5].id, student_answer: '"Best case is O(1) when the target is the first element. Worst case is O(n) when the target is last or absent. Average case is O(n/2) ≈ O(n)."', is_correct: null, marks_awarded: 2, teacher_feedback: 'Good explanation. Remember to mention that average case assumes uniform distribution.' },
  ]

  for (const row of responseRows) {
    await admin.from('responses').upsert(row, { onConflict: 'attempt_id,question_id' })
  }

  // ── 11. Released result ────────────────────────────────────────────────────
  await admin.from('results').upsert({
    attempt_id: attemptId,
    student_id: studentId,
    exam_id: examId,
    final_score: 11,
    passed: true,
    released_at: new Date().toISOString(),
  }, { onConflict: 'attempt_id' })

  return {
    ok: true,
    summary: {
      university: 'Demo University of Nigeria',
      accounts: [
        { role: 'Exam Officer', email: 'admin@dun.edu.ng',    password: 'Demo1234!' },
        { role: 'Lecturer',     email: 'lecturer@dun.edu.ng', password: 'Demo1234!' },
        { role: 'Student',      email: 'student@dun.edu.ng',  password: 'Demo1234!' },
      ],
    },
  }
}
