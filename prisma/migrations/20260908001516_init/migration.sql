BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[universities] (
    [id] NVARCHAR(36) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [subdomain] NVARCHAR(63) NOT NULL,
    [logo_url] NVARCHAR(500),
    [primary_color] NVARCHAR(32),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [universities_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [universities_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [universities_subdomain_key] UNIQUE NONCLUSTERED ([subdomain])
);

-- CreateTable
CREATE TABLE [dbo].[faculties] (
    [id] NVARCHAR(36) NOT NULL,
    [university_id] NVARCHAR(36) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [faculties_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [faculties_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [faculties_university_id_name_key] UNIQUE NONCLUSTERED ([university_id],[name])
);

-- CreateTable
CREATE TABLE [dbo].[departments] (
    [id] NVARCHAR(36) NOT NULL,
    [university_id] NVARCHAR(36) NOT NULL,
    [faculty_id] NVARCHAR(36) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [departments_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [departments_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [departments_faculty_id_name_key] UNIQUE NONCLUSTERED ([faculty_id],[name])
);

-- CreateTable
CREATE TABLE [dbo].[courses] (
    [id] NVARCHAR(36) NOT NULL,
    [university_id] NVARCHAR(36) NOT NULL,
    [department_id] NVARCHAR(36) NOT NULL,
    [course_code] NVARCHAR(20) NOT NULL,
    [course_title] NVARCHAR(200) NOT NULL,
    [credit_units] INT NOT NULL CONSTRAINT [courses_credit_units_df] DEFAULT 2,
    [level] NVARCHAR(10) NOT NULL,
    [semester] NVARCHAR(10) NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [courses_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [courses_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [courses_university_id_course_code_key] UNIQUE NONCLUSTERED ([university_id],[course_code])
);

-- CreateTable
CREATE TABLE [dbo].[users] (
    [id] NVARCHAR(36) NOT NULL,
    [university_id] NVARCHAR(36),
    [role] NVARCHAR(20) NOT NULL,
    [email] NVARCHAR(255) NOT NULL,
    [full_name] NVARCHAR(200) NOT NULL,
    [matric_number] NVARCHAR(50),
    [level] NVARCHAR(10),
    [department_id] NVARCHAR(36),
    [faculty_id] NVARCHAR(36),
    [is_active] BIT NOT NULL CONSTRAINT [users_is_active_df] DEFAULT 1,
    [date_of_birth] DATE,
    [removed_at] DATETIME2,
    [password_hash] NVARCHAR(max),
    [must_change_password] BIT NOT NULL CONSTRAINT [users_must_change_password_df] DEFAULT 0,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [users_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [users_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[sessions] (
    [id] NVARCHAR(64) NOT NULL,
    [user_id] NVARCHAR(36) NOT NULL,
    [channel] NVARCHAR(20) NOT NULL,
    [verified_exam_id] NVARCHAR(36),
    [client_ip] NVARCHAR(45),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [sessions_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [last_seen_at] DATETIME2 NOT NULL CONSTRAINT [sessions_last_seen_at_df] DEFAULT CURRENT_TIMESTAMP,
    [expires_at] DATETIME2 NOT NULL,
    CONSTRAINT [sessions_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[verification_attempts] (
    [id] NVARCHAR(36) NOT NULL,
    [matric_number] NVARCHAR(50) NOT NULL,
    [ip] NVARCHAR(45) NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [verification_attempts_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [verification_attempts_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[question_bank] (
    [id] NVARCHAR(36) NOT NULL,
    [university_id] NVARCHAR(36) NOT NULL,
    [created_by] NVARCHAR(36) NOT NULL,
    [course_id] NVARCHAR(36) NOT NULL,
    [type] NVARCHAR(20) NOT NULL,
    [body] NVARCHAR(max) NOT NULL,
    [options] NVARCHAR(max),
    [correct_answer] NVARCHAR(max),
    [explanation] NVARCHAR(max),
    [difficulty] NVARCHAR(10) NOT NULL CONSTRAINT [question_bank_difficulty_df] DEFAULT 'medium',
    [tags] NVARCHAR(max) NOT NULL CONSTRAINT [question_bank_tags_df] DEFAULT '[]',
    [is_archived] BIT NOT NULL CONSTRAINT [question_bank_is_archived_df] DEFAULT 0,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [question_bank_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [question_bank_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[exams] (
    [id] NVARCHAR(36) NOT NULL,
    [university_id] NVARCHAR(36) NOT NULL,
    [created_by] NVARCHAR(36) NOT NULL,
    [course_id] NVARCHAR(36) NOT NULL,
    [title] NVARCHAR(300) NOT NULL,
    [instructions] NVARCHAR(max),
    [duration_minutes] INT NOT NULL,
    [start_at] DATETIME2,
    [end_at] DATETIME2,
    [academic_session] NVARCHAR(20) NOT NULL,
    [semester] NVARCHAR(10) NOT NULL,
    [exam_type] NVARCHAR(20) NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [exams_status_df] DEFAULT 'draft',
    [pass_mark] INT NOT NULL CONSTRAINT [exams_pass_mark_df] DEFAULT 50,
    [randomise_questions] BIT NOT NULL CONSTRAINT [exams_randomise_questions_df] DEFAULT 0,
    [randomise_options] BIT NOT NULL CONSTRAINT [exams_randomise_options_df] DEFAULT 0,
    [access_code] NVARCHAR(12),
    [access_code_mode] NVARCHAR(10) NOT NULL CONSTRAINT [exams_access_code_mode_df] DEFAULT 'auto',
    [access_code_revoked_at] DATETIME2,
    [enforce_ip_allowlist] BIT NOT NULL CONSTRAINT [exams_enforce_ip_allowlist_df] DEFAULT 1,
    [proctoring_enabled] BIT NOT NULL CONSTRAINT [exams_proctoring_enabled_df] DEFAULT 0,
    [show_calculator] BIT NOT NULL CONSTRAINT [exams_show_calculator_df] DEFAULT 0,
    [tips] NVARCHAR(max) NOT NULL CONSTRAINT [exams_tips_df] DEFAULT '[]',
    [go_live_at] DATETIME2,
    [entry_window_minutes] INT NOT NULL CONSTRAINT [exams_entry_window_minutes_df] DEFAULT 10,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [exams_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [exams_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[exam_questions] (
    [id] NVARCHAR(36) NOT NULL,
    [exam_id] NVARCHAR(36) NOT NULL,
    [question_id] NVARCHAR(36) NOT NULL,
    [order_index] INT NOT NULL CONSTRAINT [exam_questions_order_index_df] DEFAULT 0,
    [marks] INT NOT NULL CONSTRAINT [exam_questions_marks_df] DEFAULT 1,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [exam_questions_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [exam_questions_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [exam_questions_exam_id_question_id_key] UNIQUE NONCLUSTERED ([exam_id],[question_id])
);

-- CreateTable
CREATE TABLE [dbo].[exam_access] (
    [id] NVARCHAR(36) NOT NULL,
    [exam_id] NVARCHAR(36) NOT NULL,
    [user_id] NVARCHAR(36) NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [exam_access_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [exam_access_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [exam_access_exam_id_user_id_key] UNIQUE NONCLUSTERED ([exam_id],[user_id])
);

-- CreateTable
CREATE TABLE [dbo].[attempts] (
    [id] NVARCHAR(36) NOT NULL,
    [exam_id] NVARCHAR(36) NOT NULL,
    [student_id] NVARCHAR(36) NOT NULL,
    [started_at] DATETIME2 NOT NULL CONSTRAINT [attempts_started_at_df] DEFAULT CURRENT_TIMESTAMP,
    [submitted_at] DATETIME2,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [attempts_status_df] DEFAULT 'in_progress',
    [total_score] INT,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [attempts_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [attempts_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [attempts_exam_id_student_id_key] UNIQUE NONCLUSTERED ([exam_id],[student_id])
);

-- CreateTable
CREATE TABLE [dbo].[responses] (
    [id] NVARCHAR(36) NOT NULL,
    [attempt_id] NVARCHAR(36) NOT NULL,
    [question_id] NVARCHAR(36) NOT NULL,
    [student_answer] NVARCHAR(max),
    [is_correct] BIT,
    [marks_awarded] INT NOT NULL CONSTRAINT [responses_marks_awarded_df] DEFAULT 0,
    [teacher_feedback] NVARCHAR(max),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [responses_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [responses_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [responses_attempt_id_question_id_key] UNIQUE NONCLUSTERED ([attempt_id],[question_id])
);

-- CreateTable
CREATE TABLE [dbo].[results] (
    [id] NVARCHAR(36) NOT NULL,
    [attempt_id] NVARCHAR(36) NOT NULL,
    [student_id] NVARCHAR(36) NOT NULL,
    [exam_id] NVARCHAR(36) NOT NULL,
    [final_score] INT NOT NULL,
    [passed] BIT NOT NULL,
    [released_at] DATETIME2,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [results_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [results_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [results_attempt_id_key] UNIQUE NONCLUSTERED ([attempt_id])
);

-- CreateTable
CREATE TABLE [dbo].[admin_action_log] (
    [id] NVARCHAR(36) NOT NULL,
    [university_id] NVARCHAR(36),
    [actor_id] NVARCHAR(36),
    [action] NVARCHAR(40) NOT NULL,
    [target_user_id] NVARCHAR(36),
    [subject_role] NVARCHAR(20),
    [target_identifier] NVARCHAR(255),
    [meta] NVARCHAR(max),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [admin_action_log_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [admin_action_log_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[lab_ip_allowlist] (
    [id] NVARCHAR(36) NOT NULL,
    [university_id] NVARCHAR(36) NOT NULL,
    [entry] NVARCHAR(64) NOT NULL,
    [label] NVARCHAR(120),
    [is_active] BIT NOT NULL CONSTRAINT [lab_ip_allowlist_is_active_df] DEFAULT 1,
    [created_by] NVARCHAR(36) NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [lab_ip_allowlist_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [lab_ip_allowlist_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [faculties_university_id_idx] ON [dbo].[faculties]([university_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [departments_faculty_id_idx] ON [dbo].[departments]([faculty_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [courses_department_id_idx] ON [dbo].[courses]([department_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [courses_university_id_idx] ON [dbo].[courses]([university_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [users_university_id_idx] ON [dbo].[users]([university_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [users_role_idx] ON [dbo].[users]([role]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [sessions_user_id_idx] ON [dbo].[sessions]([user_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [sessions_expires_at_idx] ON [dbo].[sessions]([expires_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [verification_attempts_matric_number_ip_created_at_idx] ON [dbo].[verification_attempts]([matric_number], [ip], [created_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [question_bank_course_id_idx] ON [dbo].[question_bank]([course_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [question_bank_created_by_idx] ON [dbo].[question_bank]([created_by]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [exams_course_id_idx] ON [dbo].[exams]([course_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [exams_status_idx] ON [dbo].[exams]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [exam_questions_exam_id_idx] ON [dbo].[exam_questions]([exam_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [attempts_exam_id_idx] ON [dbo].[attempts]([exam_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [attempts_student_id_idx] ON [dbo].[attempts]([student_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [responses_attempt_id_idx] ON [dbo].[responses]([attempt_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [results_student_id_idx] ON [dbo].[results]([student_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [results_exam_id_idx] ON [dbo].[results]([exam_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [results_released_at_idx] ON [dbo].[results]([released_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [admin_action_log_university_id_idx] ON [dbo].[admin_action_log]([university_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [admin_action_log_created_at_idx] ON [dbo].[admin_action_log]([created_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [lab_ip_allowlist_university_id_idx] ON [dbo].[lab_ip_allowlist]([university_id]);

-- AddForeignKey
ALTER TABLE [dbo].[faculties] ADD CONSTRAINT [faculties_university_id_fkey] FOREIGN KEY ([university_id]) REFERENCES [dbo].[universities]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[departments] ADD CONSTRAINT [departments_university_id_fkey] FOREIGN KEY ([university_id]) REFERENCES [dbo].[universities]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[departments] ADD CONSTRAINT [departments_faculty_id_fkey] FOREIGN KEY ([faculty_id]) REFERENCES [dbo].[faculties]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[courses] ADD CONSTRAINT [courses_university_id_fkey] FOREIGN KEY ([university_id]) REFERENCES [dbo].[universities]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[courses] ADD CONSTRAINT [courses_department_id_fkey] FOREIGN KEY ([department_id]) REFERENCES [dbo].[departments]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[users] ADD CONSTRAINT [users_university_id_fkey] FOREIGN KEY ([university_id]) REFERENCES [dbo].[universities]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[users] ADD CONSTRAINT [users_department_id_fkey] FOREIGN KEY ([department_id]) REFERENCES [dbo].[departments]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[users] ADD CONSTRAINT [users_faculty_id_fkey] FOREIGN KEY ([faculty_id]) REFERENCES [dbo].[faculties]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[sessions] ADD CONSTRAINT [sessions_user_id_fkey] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[sessions] ADD CONSTRAINT [sessions_verified_exam_id_fkey] FOREIGN KEY ([verified_exam_id]) REFERENCES [dbo].[exams]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[question_bank] ADD CONSTRAINT [question_bank_university_id_fkey] FOREIGN KEY ([university_id]) REFERENCES [dbo].[universities]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[question_bank] ADD CONSTRAINT [question_bank_created_by_fkey] FOREIGN KEY ([created_by]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[question_bank] ADD CONSTRAINT [question_bank_course_id_fkey] FOREIGN KEY ([course_id]) REFERENCES [dbo].[courses]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[exams] ADD CONSTRAINT [exams_university_id_fkey] FOREIGN KEY ([university_id]) REFERENCES [dbo].[universities]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[exams] ADD CONSTRAINT [exams_created_by_fkey] FOREIGN KEY ([created_by]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[exams] ADD CONSTRAINT [exams_course_id_fkey] FOREIGN KEY ([course_id]) REFERENCES [dbo].[courses]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[exam_questions] ADD CONSTRAINT [exam_questions_exam_id_fkey] FOREIGN KEY ([exam_id]) REFERENCES [dbo].[exams]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[exam_questions] ADD CONSTRAINT [exam_questions_question_id_fkey] FOREIGN KEY ([question_id]) REFERENCES [dbo].[question_bank]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[exam_access] ADD CONSTRAINT [exam_access_exam_id_fkey] FOREIGN KEY ([exam_id]) REFERENCES [dbo].[exams]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[exam_access] ADD CONSTRAINT [exam_access_user_id_fkey] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[attempts] ADD CONSTRAINT [attempts_exam_id_fkey] FOREIGN KEY ([exam_id]) REFERENCES [dbo].[exams]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[attempts] ADD CONSTRAINT [attempts_student_id_fkey] FOREIGN KEY ([student_id]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[responses] ADD CONSTRAINT [responses_attempt_id_fkey] FOREIGN KEY ([attempt_id]) REFERENCES [dbo].[attempts]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[responses] ADD CONSTRAINT [responses_question_id_fkey] FOREIGN KEY ([question_id]) REFERENCES [dbo].[question_bank]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[results] ADD CONSTRAINT [results_attempt_id_fkey] FOREIGN KEY ([attempt_id]) REFERENCES [dbo].[attempts]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[results] ADD CONSTRAINT [results_student_id_fkey] FOREIGN KEY ([student_id]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[results] ADD CONSTRAINT [results_exam_id_fkey] FOREIGN KEY ([exam_id]) REFERENCES [dbo].[exams]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[admin_action_log] ADD CONSTRAINT [admin_action_log_university_id_fkey] FOREIGN KEY ([university_id]) REFERENCES [dbo].[universities]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[admin_action_log] ADD CONSTRAINT [admin_action_log_actor_id_fkey] FOREIGN KEY ([actor_id]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[admin_action_log] ADD CONSTRAINT [admin_action_log_target_user_id_fkey] FOREIGN KEY ([target_user_id]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[lab_ip_allowlist] ADD CONSTRAINT [lab_ip_allowlist_university_id_fkey] FOREIGN KEY ([university_id]) REFERENCES [dbo].[universities]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[lab_ip_allowlist] ADD CONSTRAINT [lab_ip_allowlist_created_by_fkey] FOREIGN KEY ([created_by]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
