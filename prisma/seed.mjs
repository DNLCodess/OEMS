import { prisma } from '../lib/db/client.js'

const INSTITUTION_NAME  = process.env.SEED_INSTITUTION_NAME  || 'Precious Cornerstone University'
const INSTITUTION_SLUG  = process.env.SEED_INSTITUTION_SLUG  || 'pcu'
const SUPER_ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL || 'superadmin@pcu.edu.ng'
const SUPER_ADMIN_NAME  = process.env.SEED_SUPER_ADMIN_NAME  || 'System Administrator'

export async function seed() {
  // One institution. Upsert on the unique subdomain so re-running is safe.
  const university = await prisma.university.upsert({
    where: { subdomain: INSTITUTION_SLUG },
    update: { name: INSTITUTION_NAME },
    create: { name: INSTITUTION_NAME, subdomain: INSTITUTION_SLUG },
  })

  // Bootstrap super admin. password_hash stays NULL here — Slice 1 adds the
  // login flow + a one-time "set your password" step gated on
  // must_change_password. Find-or-create by email (email is not unique in
  // the schema, so we can't upsert on it).
  const existing = await prisma.user.findFirst({
    where: { email: SUPER_ADMIN_EMAIL, role: 'super_admin' },
  })
  if (!existing) {
    await prisma.user.create({
      data: {
        university_id: university.id,
        role: 'super_admin',
        email: SUPER_ADMIN_EMAIL,
        full_name: SUPER_ADMIN_NAME,
        must_change_password: true,
      },
    })
  }

  if (process.env.SEED_SAMPLE_DATA === '1') {
    await seedSampleData(university.id)
  }

  return university
}

async function seedSampleData(universityId) {
  const faculty = await prisma.faculty.upsert({
    where: { university_id_name: { university_id: universityId, name: 'Natural & Applied Sciences' } },
    update: {},
    create: { university_id: universityId, name: 'Natural & Applied Sciences' },
  })
  const department = await prisma.department.upsert({
    where: { faculty_id_name: { faculty_id: faculty.id, name: 'Computer Science' } },
    update: {},
    create: { university_id: universityId, faculty_id: faculty.id, name: 'Computer Science' },
  })
  const course = await prisma.course.upsert({
    where: { university_id_course_code: { university_id: universityId, course_code: 'CSC 301' } },
    update: {},
    create: {
      university_id: universityId, department_id: department.id,
      course_code: 'CSC 301', course_title: 'Data Structures & Algorithms',
      credit_units: 3, level: '300', semester: 'first',
    },
  })

  const lecturer = await prisma.user.findFirst({ where: { email: 'lecturer@pcu.edu.ng' } })
  if (!lecturer) {
    await prisma.user.create({
      data: {
        university_id: universityId, role: 'lecturer',
        email: 'lecturer@pcu.edu.ng', full_name: 'Demo Lecturer',
        department_id: department.id, faculty_id: faculty.id,
        must_change_password: true,
      },
    })
  }
  const student = await prisma.user.findFirst({ where: { matric_number: 'CSC/2021/001', university_id: universityId } })
  if (!student) {
    await prisma.user.create({
      data: {
        university_id: universityId, role: 'student',
        email: 'student@pcu.edu.ng', full_name: 'Demo Student',
        matric_number: 'CSC/2021/001', level: '300',
        department_id: department.id, faculty_id: faculty.id,
        date_of_birth: new Date('2003-05-14'),
      },
    })
  }
  return { faculty, department, course }
}

// Allow `node prisma/seed.mjs` and `prisma db seed`.
if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then(() => { console.log('Seed complete.'); return prisma.$disconnect() })
    .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
}
