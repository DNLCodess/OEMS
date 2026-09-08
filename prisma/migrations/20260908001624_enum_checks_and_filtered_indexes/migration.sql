-- Enum-like CHECK constraints (values mirror lib/db/enums.js).
ALTER TABLE [users]            ADD CONSTRAINT [ck_users_role]             CHECK ([role] IN ('super_admin','school_admin','lecturer','student'));
ALTER TABLE [users]            ADD CONSTRAINT [ck_users_level]            CHECK ([level] IS NULL OR [level] IN ('100','200','300','400','500','PG'));
ALTER TABLE [users]            ADD CONSTRAINT [ck_users_students_matric]  CHECK ([role] <> 'student' OR [matric_number] IS NOT NULL);
ALTER TABLE [courses]          ADD CONSTRAINT [ck_courses_level]          CHECK ([level] IN ('100','200','300','400','500','PG'));
ALTER TABLE [courses]          ADD CONSTRAINT [ck_courses_semester]       CHECK ([semester] IN ('first','second'));
ALTER TABLE [courses]          ADD CONSTRAINT [ck_courses_credit_units]   CHECK ([credit_units] BETWEEN 1 AND 6);
ALTER TABLE [exams]            ADD CONSTRAINT [ck_exams_semester]         CHECK ([semester] IN ('first','second'));
ALTER TABLE [exams]            ADD CONSTRAINT [ck_exams_exam_type]        CHECK ([exam_type] IN ('ca','mid_semester','end_of_semester'));
ALTER TABLE [exams]            ADD CONSTRAINT [ck_exams_status]           CHECK ([status] IN ('draft','scheduled','live','closed'));
ALTER TABLE [exams]            ADD CONSTRAINT [ck_exams_access_code_mode] CHECK ([access_code_mode] IN ('auto','manual'));
ALTER TABLE [exams]            ADD CONSTRAINT [ck_exams_pass_mark]        CHECK ([pass_mark] BETWEEN 0 AND 100);
ALTER TABLE [exams]            ADD CONSTRAINT [ck_exams_duration]         CHECK ([duration_minutes] > 0);
ALTER TABLE [exams]            ADD CONSTRAINT [ck_exams_entry_window]     CHECK ([entry_window_minutes] > 0);
ALTER TABLE [exam_questions]   ADD CONSTRAINT [ck_exam_questions_marks]   CHECK ([marks] > 0);
ALTER TABLE [question_bank]    ADD CONSTRAINT [ck_qb_type]                CHECK ([type] IN ('mcq','multi_select','true_false','fill_blank','short_answer','essay'));
ALTER TABLE [question_bank]    ADD CONSTRAINT [ck_qb_difficulty]          CHECK ([difficulty] IN ('easy','medium','hard'));
ALTER TABLE [attempts]         ADD CONSTRAINT [ck_attempts_status]        CHECK ([status] IN ('in_progress','submitted','graded'));
ALTER TABLE [sessions]         ADD CONSTRAINT [ck_sessions_channel]       CHECK ([channel] IN ('password','exam_access','result_lookup'));
ALTER TABLE [admin_action_log] ADD CONSTRAINT [ck_aal_action]            CHECK ([action] IN ('activated','deactivated','removed','logged_in','logged_out','login_failed','exam_entry_ip_blocked'));

-- Filtered unique indexes (Prisma's @@unique can't express a WHERE clause).
-- Matric numbers unique per university, but only when set (staff rows have NULL).
CREATE UNIQUE INDEX [ux_users_matric_per_university]
  ON [users] ([university_id], [matric_number])
  WHERE [matric_number] IS NOT NULL;

-- An access code resolves to exactly one exam among non-revoked exams.
CREATE UNIQUE INDEX [ux_exams_active_access_code]
  ON [exams] ([access_code])
  WHERE [access_code] IS NOT NULL AND [access_code_revoked_at] IS NULL;
