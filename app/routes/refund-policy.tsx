import {
  REFUND_COMPLETION_LIMIT,
  REFUND_WATCH_LIMIT_SECONDS,
  REFUND_WINDOW_DAYS,
} from "~/lib/refund-requests";

// The public Refund Policy. It states only four limits, on purpose: do not add
// the finer rules here (docs/adr/0004).

export function meta() {
  return [
    { title: "Refund Policy — Cadence" },
    {
      name: "description",
      content: "When you can get a refund on a Cadence course.",
    },
  ];
}

const watchLimitHours = REFUND_WATCH_LIMIT_SECONDS / 60 / 60;
const completionLimit =
  REFUND_COMPLETION_LIMIT === 0.5
    ? "half"
    : `${REFUND_COMPLETION_LIMIT * 100}%`;

const questions = [
  {
    question: "How long do I have to ask for a refund?",
    answer: `${REFUND_WINDOW_DAYS + 1} days, counting the day you bought the course.`,
  },
  {
    question: "How much of the course can I watch and still get a refund?",
    answer: `Less than ${watchLimitHours} hours of it.`,
  },
  {
    question: "How many lessons can I complete and still get a refund?",
    answer: `Less than ${completionLimit} of the course's lessons.`,
  },
  {
    question: "How many refunds can I get?",
    answer: "One. Each student can have one refund.",
  },
];

export default function RefundPolicy() {
  return (
    <div className="mx-auto max-w-2xl p-6 lg:p-8">
      <h1 className="text-3xl font-bold">Refund Policy</h1>
      <p className="mt-2 text-muted-foreground">
        You can ask for a refund on a course you bought, from the course's page.
      </p>
      <dl className="mt-8 space-y-6">
        {questions.map(({ question, answer }) => (
          <div key={question}>
            <dt className="font-semibold">{question}</dt>
            <dd className="mt-1 text-muted-foreground">{answer}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
