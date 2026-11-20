CREATE TABLE `sent_notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipient_id` integer NOT NULL,
	`kind` text NOT NULL,
	`comment_id` integer,
	`refund_request_id` integer,
	`workflow_run_id` text NOT NULL,
	`sent_at` text NOT NULL,
	`marked_read_at` text,
	FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`refund_request_id`) REFERENCES `refunds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sent_notifications_recipient_idx` ON `sent_notifications` (`recipient_id`,`kind`);