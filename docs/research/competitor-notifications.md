# What Notifications do Udemy, Udacity and Coursera send?

Research for issue #14. Scope: Notifications about something that happened (no marketing or promotional email). Researched 2026-11-15.

## How this was sourced

Every claim cites an official help-center article, an official blog post or the official privacy policy. The Udemy and Udacity help centres (Zendesk) returned HTTP 403 to direct fetches, and the Coursera help centre (Salesforce) only renders with JavaScript. So most quotes come from search-engine copies of those official pages, not from loading the live page. Several Udemy articles are about 5 years old. The UI may have changed since then, so read the wording below as "documented behaviour", not as a picture of today's screens.

Confidence: **High** means quoted directly from an official article. **Medium** means the official article was seen only as a search-index copy, or the source is old. **Low** means it was inferred or only partly documented.

---

## Udemy

### Triggers and channels: Students

| Event | Channel | Source |
| --- | --- | --- |
| Instructor sends a direct message | Email, plus "a notification will appear on their Udemy profile" (in-app) | [U3] (High) |
| Instructor posts an educational announcement | Email inbox, and the announcement also shows in the course's Announcements section. Limit of 4 educational announcements per course per month | [U6], [U7] (Medium) |
| Purchase or enrolment confirmed | Email from `udemy@email.udemy.com` | [U8] (Medium) |
| Refund Request processed | Email: "You will also be sent an email confirming that your refund request has been processed." Status is also visible in purchase history | [U8] (High) |
| Learning reminder the Student scheduled | Calendar event or reminder, created under My learning > Learning tools. Daily, weekly or once | [U9] (Medium) |

### Triggers and channels: Instructors

| Event | Channel | Source |
| --- | --- | --- |
| New question or response in course Q&A | In-app bell. Also a push notification in the mobile app | [U2], [U4] (Medium) |
| Reply in a Q&A thread | Email, **cannot be turned off** | [U2] (High) |
| New direct message | Email with a "Reply to Message" button, **cannot be turned off** | [U2], [U3] (High) |
| Comment on a course announcement | In-app bell | [U2] (Medium) |
| Feedback or responses on assignments | In-app bell | [U2] (Medium) |
| Auto-generated captions ready | In-app bell | [U2] (Medium) |
| Lecture ready (processing finished) | Email ("lecture ready confirmations") | [U2] (Medium) |
| New Students and new reviews | Email **daily digest** ("New Student & Review Daily Digest"). Push in the mobile app | [U2], [U4] (Medium) |
| Q&A activity | Email **daily digest** ("Daily Q&A Digest") | [U2] (Medium) |
| Payout processed or failed | Email | [U10] (High) |
| Student refund | No per-refund instructor notification is documented. Refunds show up only as deductions in the Revenue and Payout reports | [U10] (Low: absence of evidence) |

### Triggers and channels: Udemy Business admins

| Event | Channel | Source |
| --- | --- | --- |
| Licence pool nearly used up | Email to **all admins and owners**, at most **once a month** after the threshold is reached. Opt-in under Manage > Settings > Email reminders. Thresholds are 95%, 98% or 100% of licences assigned | [U11] (High) |
| Invited user has not joined after 48 hours | Automatic reminder email to the **invitee** (not the admin) | [U12] (Medium) |
| User signs up when no licence is left | No admin notification. The user sees an error page telling them to contact their admin | [U12] (Medium) |

### In-app surface

- A **notification bell at the top right**, with unread items shown as "a red number" on the bell [U2] (Medium).
- Instructor Q&A dashboard: each question has its own read/unread state. A question is marked read automatically when the Instructor opens or replies to it, and can be toggled manually "by clicking on the dot" [U5] (Medium).
- Mobile instructor app: push notifications for direct messages, Q&A and reviews, with a choice of **frequency** [U4] (Medium).
- No official doc found describing tabs, "mark all as read" or how long notifications are kept (not documented).

### Settings

- **Students:** Account settings > Notification Preferences, grouped into categories ("Updates and offerings", "Your learning"). Each category has a **category toggle plus a checkbox per item** [U1] (Medium).
- **Students, per course:** on the course overview page, the "..." menu next to Course details has toggles for **new announcement emails** and promotional emails for that course only [U1], [U6] (Medium).
- **Instructors:** Account > Notification Settings, plus **per course** settings (course management > gear > Manage Email Notifications) [U2] (High).
- **Can't be turned off:** transactional emails, Q&A reply notifications and new direct message notifications [U2] (High).
- Quirk: the digests depend on the "Helpful resources and important updates related to being an instructor" box, and checking "Don't send me any promotional emails" also stops the Q&A digest, the Student and review digest, and lecture-ready emails. Udemy mixes event Notifications and marketing under one switch [U2] (High).

---

## Udacity

### Triggers and channels: Students

| Event | Channel | Source |
| --- | --- | --- |
| Project reviewed | Email. The Project Reviews category also offers text/SMS | [D1] (Medium), [D5] (Medium) |
| Someone answers your question in Knowledge (Q&A forum) | Email "every time someone answers your question", and the answer is also listed in the **Activity tab** in Knowledge | [D2] (High) |
| Mentor answers your queued question | Email, and the Activity tab | [D3] (High) |
| Payment due or failed | "Payment Reminders" category: email, phone or SMS | [D1] (Medium) |
| Learning progress or study reminders | "Learning Progress" category: email or SMS. The privacy policy mentions "text message study reminders" | [D1], [D4] (Medium) |
| Alumni services, mentor communications, community notifications | Categories in Notification Preferences | [D1], [D4] (Medium) |

Udacity's Instructors are internal staff or contracted reviewers and mentors, not marketplace sellers. No help-center docs were found for instructor-facing notifications. Enterprise admin notifications were also not documented publicly.

### In-app surface

- No notification bell or centre is documented. The only in-app equivalent found is the **Activity tab** inside Knowledge, which lists questions asked and answers received [D2] (High).

### Settings

- Settings > **Notification Preferences** is a grid of **category × channel** checkboxes. The categories are Payment Reminders, Learning Progress, Alumni Services, Project Reviews and Marketing Communications. The channels are email, phone and SMS: "uncheck the box if you do not want to receive notifications for that communication type" [D1] (Medium).
- A **global** checkbox at the bottom unsubscribes from all email or SMS notifications [D1] (Medium).
- SMS needs a verified phone number and is capped at "up to three messages per day" [D1] (Medium).
- No per-course setting was documented. No category was documented as impossible to turn off.

---

## Coursera

### Triggers and channels: learners

| Event | Channel | Source |
| --- | --- | --- |
| Course announcement, deadline reminder, discussion forum activity | Email ("Communication about courses you are enrolled in: Includes announcements, reminders, and discussion forum notifications") | [C1] (Medium) |
| New reply on a forum thread you **Follow** | Email. Follow or Unfollow sits at the bottom of each post ("Subscribe for email updates" on older courses) | [C2] (Medium) |
| Degree or for-credit programme events | Email ("Communication from Degree partner") | [C1] (Medium) |
| Removed from an organisation's learning programme | Automated email to the recovery address | [C5] (Medium) |
| Learning tips or "dive back in" nudges | Mobile push (opt-in). This is a re-engagement nudge, not an event | [C3] (High, 2019 post) |
| Community forum (support community) activity | Email per group or topic, with **instant, daily digest or weekly digest** options. Managed in the Support Center, not on coursera.org | [C4] (Medium) |

Coursera educators (partner universities) and Coursera for Business admins: no public docs on the Notifications they receive were found. Admin activity (invitations sent, learners joined, enrolments) is shown on an **admin dashboard**, and admins *send* bulk reminder emails to learners. Coursera treats this as a dashboard plus outbound messages, not as Notifications to the admin [C6] (Medium).

### In-app surface

- No official doc describes a web notification bell or centre. The official surfaces are email and mobile push [C1], [C3] (Low: absence of evidence).

### Settings

- Settings > **Communication Preferences** has one checkbox **per category** (from Coursera, about enrolled courses, from partners, from Degree partner) [C1] (Medium).
- **Global**: "Opt-out of all Coursera emails" at the top of the page [C1] (Medium).
- **Per course**: a "Course Preferences" email toggle for each course is referenced [C2] (Medium), but where it lives is not documented.
- **Per thread**: Follow or Unfollow on each forum post [C2] (Medium).
- Degree learners are told to keep Degree-programme email on. Nothing was documented as impossible to turn off.

---

## Cross-platform patterns

1. **Email is the main channel everywhere.** Only Udemy documents a web in-app bell with an unread count, and only Udacity offers SMS.
2. **A reply to *your* question is the strongest trigger.** All three notify on it: Udemy Q&A replies, Udacity Knowledge answers, Coursera followed threads. Udemy makes it impossible to turn off.
3. **Direct messages and transactional events can't be turned off** on Udemy (Purchase, refund processed, payout). Nobody lets you turn off receipts.
4. **High-volume Instructor events are batched into digests** (Udemy's Daily Q&A Digest and New Student & Review Daily Digest), while the bell shows each one individually.
5. **Settings granularity** goes global, then per category, then per channel (Udacity's grid), then per course (Udemy, Coursera), then per thread (Coursera Follow).
6. **Admin Notifications are thin.** The only documented admin Notification is Udemy Business's opt-in "licences nearly exhausted" email to all admins and owners, at most once a month. Everything else is a dashboard.
7. **Announcements are rate-limited** (Udemy: 4 per course per month), which protects Students from noise.

## Mapping to Cadence features

| Cadence feature | Closest competitor pattern | Suggested Notification |
| --- | --- | --- |
| Lesson comments / Q&A: a reply to a Student's question | Udemy Q&A replies (can't be turned off), Udacity Knowledge answer email plus Activity tab, Coursera Follow | Notify the question's author when someone replies. Highest-value Student Notification |
| Lesson comments / Q&A: a new question on an Instructor's course | Udemy bell item for each question, plus the Daily Q&A Digest by email | In-app item for the Instructor for each question. Email, if any, as a digest |
| Purchase completed | Udemy enrolment confirmation email (transactional) | Transactional: confirm to the Student. Optionally notify the Instructor, but Udemy batches new Students into a daily digest |
| Refund Request submitted, approved or rejected | Udemy "refund request has been processed" email. Status in purchase history | Notify the Student when the Refund Request is resolved. Treat as transactional (not optional). Instructor: Udemy sends nothing per refund, so a Cadence Notification here would go beyond the competitors |
| Team Licence Seats running out | Udemy Business low-licence email: opt-in, 95/98/100% thresholds, all admins and owners, at most once a month | Notify the Team Admin when the Seats are nearly or fully used |
| Team Admin assigns a Seat or invites a member | Udemy Business invite email plus a 48-hour reminder to the invitee | Notify the invited Student. Udemy sends no admin Notification when a user joins |
| Quiz results | Udacity "Project reviewed" email or SMS. Coursera AI-grader notice | Only relevant if quizzes are graded asynchronously. Instant results need no Notification |
| Instructor announcement (if added) | Udemy educational announcements: email plus course page, with a monthly cap | Per-course opt-out for the Student, as Udemy does |
| Platform Admin | No documented equivalent | Likely none in v1, or reuse Refund Request queue counts |

Settings model to consider: give **each kind of Notification** a toggle, optionally split **by channel** (in-app or email). Keep **transactional kinds** (Purchase, Refund Request outcome, direct replies to your own question) **always on**, as Udemy does. Add a per-course mute later if needed.

---

## Sources

- [U1] Udemy: Account & profile settings / Notification Preferences. https://support.udemy.com/hc/en-us/sections/206458288-Account-and-Profile-General
- [U2] Udemy: How to unsubscribe from Udemy or instructor notifications. https://support.udemy.com/hc/en-us/articles/229231147-Unsubscribe-From-Udemy-Notifications
- [U3] Udemy: Instructors: How to Manage The Direct Messaging Tool. https://support.udemy.com/hc/en-us/articles/229231387-Instructors-How-to-Manage-The-Direct-Messaging-Tool
- [U4] Udemy: Getting Started With The Instructor Mobile Experience: Android. https://support.udemy.com/hc/en-us/articles/360007846994-Getting-Started-With-The-Instructor-Mobile-Experience-Android
- [U5] Udemy: Instructor Q&A Dashboard. https://support.udemy.com/hc/en-us/articles/229606328-Instructor-Q-A-Dashboard
- [U6] Udemy: Send Promotional Emails and Educational Announcements. https://support.udemy.com/hc/en-us/articles/229605788-Send-Promotional-Emails-and-Educational-Announcements
- [U7] Udemy: Educational announcements: Rules and guidelines. https://support.udemy.com/hc/en-us/articles/229605828-Educational-announcements-Rules-and-guidelines
- [U8] Udemy: How to Refund a Course. https://support.udemy.com/hc/en-us/articles/229604248-Refund-a-course
- [U9] Udemy: How to Schedule Learning Reminders on a Browser. https://support.udemy.com/hc/en-us/articles/4501093209367-How-to-Schedule-a-Learning-Calendar-Event
- [U10] Udemy: Instructor Payment Overview. https://support.udemy.com/hc/en-us/articles/229604008-Instructor-payment-overview
- [U11] Udemy Business: Email Reminders for Low License Availability. https://business-support.udemy.com/hc/en-us/articles/33345372897559-Email-Reminders-for-Low-License-Availability
- [U12] Udemy Business: Managing users (invites, licences). https://business-support.udemy.com/hc/en-us/sections/4419746961431-Managing-users-general
- [D1] Udacity: Managing email, phone, and SMS notifications. https://support.udacity.com/hc/en-us/articles/360054514271-Managing-email-phone-and-SMS-notifications
- [D2] Udacity: How do I know if my question has been answered in Knowledge? https://support.udacity.com/hc/en-us/articles/360039084211-How-do-I-know-if-my-question-has-been-answered-in-Knowledge
- [D3] Udacity: How do I post a question for a mentor on Knowledge? https://support.udacity.com/hc/en-us/articles/360041115792-How-do-I-post-a-question-for-a-mentor-on-Knowledge-How-do-I-ask-for-help-from-a-mentor
- [D4] Udacity: Privacy policy (Notification Preferences section). https://www.udacity.com/en-US/legal/privacy
- [D5] Udacity blog: Is Udacity Project Review In Your Employment Future? https://www.udacity.com/blog/is-udacity-project-review-in-your-employment-future/
- [C1] Coursera: Check and update your email communication preferences. https://www.coursera.support/s/article/learner-000001611?language=en_US
- [C2] Coursera: Change email settings for the forums. https://www.coursera.support/s/article/learner-000001272?language=en_US
- [C3] Coursera blog: Updates to Your Learning Experience on Coursera (2019-03-19). https://blog.coursera.org/updates-to-your-learning-experience-on-coursera/
- [C4] Coursera: Community Quick Start Guide. https://www.coursera.support/s/article/Community-Quick-Start-Guide?language=en_US
- [C5] Coursera: Recover your learning progress after leaving your organization. https://www.coursera.support/s/article/learner-000002365?language=en_US
- [C6] Coursera blog: Q1 Coursera for Business Quarterly Product Release. https://blog.coursera.org/q1-coursera-for-business-quarterly-product-release/
