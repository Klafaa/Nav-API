CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`operation` text NOT NULL,
	`request_id` text NOT NULL,
	`http_status` integer,
	`duration_ms` integer,
	`success` integer NOT NULL,
	`error_code` text,
	`error_message` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_request_id` ON `audit_log` (`request_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_operation` ON `audit_log` (`operation`);--> statement-breakpoint
CREATE TABLE `invoice_ops` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`index_in_batch` integer NOT NULL,
	`operation` text NOT NULL,
	`invoice_number` text,
	`invoice_data_base64` text,
	`electronic_invoice_hash` text,
	`completeness_indicator` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_inv_op_tx` ON `invoice_ops` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_inv_op_inv_num` ON `invoice_ops` (`invoice_number`);--> statement-breakpoint
CREATE TABLE `technical_users` (
	`id` text PRIMARY KEY NOT NULL,
	`tax_number` text NOT NULL,
	`login` text NOT NULL,
	`password` text NOT NULL,
	`sign_key` text NOT NULL,
	`exchange_key` text NOT NULL,
	`label` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tech_users_tax_number` ON `technical_users` (`tax_number`);--> statement-breakpoint
CREATE INDEX `idx_tech_users_login` ON `technical_users` (`login`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`request_id` text NOT NULL,
	`operation` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`technical_user_id` text NOT NULL,
	`request_timestamp` text NOT NULL,
	`finished_at` text,
	`error_code` text,
	`error_message` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_transaction_id_unique` ON `transactions` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_tx_status` ON `transactions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_tx_user` ON `transactions` (`technical_user_id`);