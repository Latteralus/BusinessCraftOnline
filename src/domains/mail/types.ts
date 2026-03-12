export type MailThreadKind = "player" | "system";
export type MailParticipantRole = "sender" | "recipient" | "system_recipient";
export type MailSenderType = "player" | "system";

export type MailRecipientPreview = {
  playerId: string;
  characterName: string;
};

export type MailCounterpart = {
  playerId: string | null;
  characterName: string;
};

export type MailMessage = {
  id: string;
  threadId: string;
  senderPlayerId: string | null;
  senderType: MailSenderType;
  senderCharacterName: string;
  body: string;
  createdAt: string;
};

export type MailThreadPreview = {
  id: string;
  kind: MailThreadKind;
  subject: string;
  systemKey: string | null;
  counterpart: MailCounterpart;
  latestMessage: MailMessage | null;
  unread: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MailThreadDetail = MailThreadPreview & {
  messages: MailMessage[];
};

export type MailboxData = {
  threads: MailThreadPreview[];
  activeThread: MailThreadDetail | null;
};
