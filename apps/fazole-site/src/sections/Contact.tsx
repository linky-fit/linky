import {
  Form,
  Notice,
  Row,
  SegmentedControl,
  Stack,
  SubmitButton,
  Text,
  TextField,
  useMedia,
} from "@linky-fit/ui";
import { useState } from "react";
import { sendContactMessage } from "../contact";
import { isEmail } from "../contactMessage";
import type { ContactMessage } from "../contactMessage";
import { useCopy } from "../locale";
import { Reveal, SiteSection } from "./parts";
import { sectionIds } from "./sectionIds";

/** Which one of the two the sender gives; the other stays empty. */
type Channel = "email" | "phone";

type State = "idle" | "sending" | "sent" | "failed";

const optional = (value: string): string | undefined =>
  value.trim() === "" ? undefined : value.trim();

/** The one thing the form asks for: a way to reach the sender. Sent as a Nostr chat message to us. */
export function Contact() {
  const c = useCopy().contact;
  const { wide } = useMedia();
  const Columns = wide ? Row : Stack;
  const [channel, setChannel] = useState<Channel>("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  // The honeypot: never shown, so only a bot fills it.
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [state, setState] = useState<State>("idle");

  const submit = async () => {
    const contact: ContactMessage =
      channel === "email"
        ? { ...(optional(email) ? { email: email.trim() } : {}) }
        : { ...(optional(phone) ? { phone: phone.trim() } : {}) };
    if (channel === "email" && !(contact.email && isEmail(contact.email))) {
      setError(c.emailInvalid);
      return;
    }
    if (channel === "phone" && !(contact.phone && contact.phone.length >= 3)) {
      setError(c.phoneInvalid);
      return;
    }
    setError(undefined);
    setState("sending");
    const sent = await sendContactMessage({
      ...contact,
      ...(optional(message) ? { message: message.trim() } : {}),
      ...(optional(website) ? { website: website.trim() } : {}),
    });
    setState(sent ? "sent" : "failed");
    if (sent) {
      setEmail("");
      setPhone("");
      setMessage("");
    }
  };

  return (
    <SiteSection id={sectionIds.contact}>
      <Reveal>
        <Columns gap={wide ? "$huge" : "$xxl"} alignItems="flex-start">
          <Stack flex={wide ? 1 : undefined} flexBasis={wide ? 0 : undefined}>
            <Text
              variant="heading"
              color="$colorStrong"
              role="heading"
              aria-level={2}
            >
              {c.title}
            </Text>
            <Text color="$colorMuted">{c.body}</Text>
          </Stack>
          <Stack
            flex={wide ? 1 : undefined}
            flexBasis={wide ? 0 : undefined}
            width="100%"
            maxWidth="$sheetWidth"
          >
            {state === "sent" ? (
              <Notice
                tone="accent"
                icon="Check"
                title={c.sentTitle}
                description={c.sentBody}
              />
            ) : (
              <Form onSubmit={() => void submit()} gap="$lg">
                <SegmentedControl
                  accessibilityLabel={c.channel}
                  value={channel}
                  onValueChange={(next) => {
                    setChannel(next);
                    setError(undefined);
                  }}
                  options={[
                    { value: "email", label: c.email },
                    { value: "phone", label: c.phone },
                  ]}
                />
                {channel === "email" ? (
                  <TextField
                    label={c.emailLabel}
                    hideLabel
                    placeholder={c.emailLabel}
                    value={email}
                    onChangeText={setEmail}
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    error={error}
                  />
                ) : (
                  <TextField
                    label={c.phoneLabel}
                    hideLabel
                    placeholder={c.phoneLabel}
                    value={phone}
                    onChangeText={setPhone}
                    inputMode="tel"
                    autoComplete="tel"
                    error={error}
                  />
                )}
                <TextField
                  label={c.message}
                  hideLabel
                  placeholder={c.messagePlaceholder}
                  value={message}
                  onChangeText={setMessage}
                  multiline
                />
                <Stack
                  aria-hidden
                  position="absolute"
                  left={-9999}
                  width={1}
                  height={1}
                  overflow="hidden"
                >
                  <TextField
                    label="Website"
                    hideLabel
                    value={website}
                    onChangeText={setWebsite}
                    autoComplete="off"
                  />
                </Stack>
                {state === "failed" ? (
                  <Notice tone="danger" title={c.failed} />
                ) : null}
                <Row justifyContent="space-between" flexWrap="wrap" gap="$md">
                  <Text variant="caption" color="$colorMuted" flexShrink={1}>
                    {c.privacy}
                  </Text>
                  <SubmitButton
                    variant="secondary"
                    icon="Send"
                    loading={state === "sending"}
                  >
                    {c.submit}
                  </SubmitButton>
                </Row>
              </Form>
            )}
          </Stack>
        </Columns>
      </Reveal>
    </SiteSection>
  );
}
