# Clover card payments

Players pay the nightly desk fee by card on the club's Clover device. The desk
reads those payments and marks the player **Credit ✓**, the same way Zeffy play
passes already show up. A player who paid before checking in shows Credit ✓ as
soon as they are added. A player who pays after checking in turns Credit ✓ at
the desk's next check, about once a minute while tonight's date is open. The
organizer only handles the payments the desk could not match with confidence.
The plan and its history are in
[issue #87](https://github.com/jb-cttc/concordtabletennisclub/issues/87).

Code: `apps-script/CloverPayments.js` (reading Clover, the matching rules and
the desk's server functions), the **Clover card payments** section of
`apps-script/Index.html`, and the Clover payments page `apps-script/Clover.html`
(`?view=clover` on the desk's address).

## 1. Setup

1. **Token.** In the Clover web dashboard, on a computer (the phone layout hides
   these menus), open **Settings → API Tokens → Create new token**. Do not use
   **Ecommerce API Tokens**: those are for online card charges and cannot be
   made read-only. Name it `CTTC desk`. Tick **Read** only (no Write) for
   **Customers**, **Orders** and **Payments**.
2. **Merchant ID.** It is the code after `/m/` in the dashboard's address bar.
3. **Script Properties.** At script.google.com, signed in as the club account,
   open **CTTC Round Robin App** → **Project Settings** → **Script
   Properties**, and add `CLOVER_API_TOKEN` and `CLOVER_MERCHANT_ID`. Never put
   either value in GitHub, an issue or a chat: the repository is public.
4. **Switch it on** after the release is live at `/exec`: add `CLOVER_ENABLED`
   = `true`. Until then the desk and the Clover page only show what they would
   do and write nothing (a dry run). `/dev` and `/exec` share Script
   Properties, so switching it on is the same for both.

If the token leaks, delete it in the same Clover screen, create a new one and
replace `CLOVER_API_TOKEN`.

## 2. How a payment is matched

Clover rarely knows the payer's name: a tap-to-pay card comes through as
"VISA CARDHOLDER" or blank. Most matches therefore come from **cards the desk
has learned**. A payment is matched only when the evidence points to exactly
one player, in this order:

| # | Evidence | Learned from |
| --- | --- | --- |
| 1 | A card (brand, first 6 and last 4 digits), Clover customer, phone or email already linked to one player | A match by hand with **Remember this card**, a match by the name on the card, or a card saved on the Clover page |
| 2 | The name on the card, or on the Clover customer, is exactly one player's name or saved alias | `Players`, `Aliases` |
| 3 | The same last name, with a first name or initial only one active player fits ("J SMITH", "Rob"/"Robert") | `Players`, `Aliases` |

The amount must then be that player's fee for the night: Junior $5, Member
$10, Visitor $15, or $10 on a first visit; $5 for everyone, and $0 for a volunteer playing free, on a Friday or Saturday
from November 13 to December 31, 2026 (see
[Session fees](round-robin-operations.md#session-fees-and-zeffy)). A payer can also cover someone else
on the same payment when they are linked under **Pays for** in the payer's
pencil window on the desk (a `pays_for` row in the private `NameLinks` tab;
never typed into the Sheet). The payment then matches when the fees of the
payer, and of the people they pay for, add up to the amount.

Everything else waits for the organizer, with the likely player shown:
- a wrong amount (an overpayment covering someone else, for example);
- a Zeffy play pass holder's card that no link adds up for: it paid for
  someone else, so the holder is shown as whose card it is and never ticked;
- a second payment for the same player;
- a method already chosen by hand (paid twice?);
- a name that fits more than one player;
- a card that has paid for two different people.

**Credit marked by hand.** A payment no card or name fits is paired with
whoever the organizer marked **Credit** on their payment button and no Clover
payment covers yet, at that payment's amount, nearest in time first, each
person once. The section ticks that person and says why ("Likely Drew: marked
Credit at 7:03 PM"). It is matched by itself (as *Credit marked at the same
time*) only when it is the only such payment at that amount, that person is
the only Credit waiting at that fee, they are within 15 minutes of each other,
and the organizer never undid that payment. No card is learned from it. The
Clover page's comparison with the records does not use this clue.

**Earlier nights.** With no Credit mark to go on, the desk looks at what the
same card (brand and last 4 digits) paid for on earlier nights: the one player
it paid for before, at this fee and unpaid tonight, is ticked ("Likely Defrim:
this card paid for them on Nov 4 and Nov 9"), and anyone else it paid for is
listed. Among the rest, players who paid by card on at least two thirds of
their last 10 nights with a payment (3 or more) come first, tagged **usually
card**. Neither clue ever matches a payment by itself.

A member's juniors count as players they pay for, so a parent's $15 for
themselves and their junior matches by itself. A payer whose Zeffy play pass
covers the night owes nothing, so their own fee never counts: a pass holder's
$5 for their junior matches the junior by itself, on a $5 special night too.

A refund, a void, a decline, or cash typed into Clover is never matched.

## 3. At the desk

The **Clover card payments** section sits in the sidebar above the Zeffy play
passes. Its count is the number of payments waiting for the organizer.

- **Waiting payments.** Each shows the amount, the card, the time, any name on
  the card, and why it is waiting. Tick who it is for. The likely payer is
  already ticked, and anyone checked in tonight can be added from the list.
  **Fees $x of $y** shows whether the ticked players' fees add up to the
  payment. **Match** records Credit for each of them, replacing a method
  chosen by hand. With one player ticked, **Remember this card** (on by
  default) links the card to them, so it matches by itself next time.
- **One payment for two.** An amount no single fee fits offers **For two?**
  pairs whose fees add up, those marked Credit or linked first; one press
  ticks both. With two or more ticked, **Whose card?** (the card's known owner
  to start with, or *Not sure*) decides whom the card is remembered for. It is
  also asked when the card is known to be someone not ticked (a Zeffy pass
  holder, say), or when someone pays for the ticked player (a parent, or a
  pays-for link): then it starts at *Not sure*, and nothing is remembered
  until the organizer chooses.
- **Someone else checked in** lists players marked Credit by hand first.
  Choosing Credit on a payment button makes the section check Clover again
  once Google has it, rather than at the next minute.
- **Pays for.** When a card the desk knows has covered the same player on two
  payments, the top of the section offers to save that its owner pays for
  them. **Review** says what it does; **Confirm and save** adds the link (the
  same as **Pays for** in the payer's pencil window), and their payments then
  match by themselves. **Not now** hides it on this device for the night.
- **Before finalizing**, the confirmation says how many Clover payments are
  still to match and how many players are marked Credit with no Clover
  payment. They can be matched after finalizing too.
- **Not a desk fee** sets a payment aside (something other than a night at the
  club). It is never matched.
- **Matched** (folded) lists tonight's matches. **Undo** puts the players back
  to unpaid, unless their method was changed by hand since. It also makes the
  card forget them, and the payment then waits for the organizer: it never
  matches by itself again.
- A match whose player was later marked another way by hand (Cash, say) comes
  back to the waiting list, so the organizer can see it and undo it.
- If Clover refunds or voids a payment after it was matched, the desk takes the
  Credit back and lists the payment under **Refunds and set aside**.

Matches are recorded by themselves only on tonight's date (or last night's,
for a desk still open after midnight). Opening an earlier night never changes
it: a match there waits in the list, already ticked, for **Match** to confirm.

On the player's payment button, a Clover match is the usual **Credit ✓**.
Hovering it shows "Clover 7:02 PM, $10". Matching, undoing and setting aside go
through the desk's queue like payment choices: they are kept on the device
until Google confirms them, and sent when the connection returns.

## 4. The Clover payments page

**Every night** at the foot of the desk section opens `?view=clover`. It shows
every night in a date range: each Clover payment, what the desk does with it,
and how that compares with the method chosen by hand.

**Cards learned from your records** proposes cards from the hand records made
before Clover matching started. Clover sends no name for a tapped card, so
this uses only the payments chosen at the desk. Each night a card paid once,
the payer must be one of the players marked Credit at the card's amount that
night. A card is proposed when exactly one player fits every night it paid,
after setting aside players whose own card paid that night. If another card
that paid the same night could also only be that player, the records can't
say which card is theirs, and neither is proposed. Such cards appear under
**Cards to check**, along with cards that fit one player on every night but
one. The result never depends on the order cards are looked at. A card
already matched at the desk with **Remember this card**, or saved here, counts
as settled from the start. Matching one card of such a pair at the desk
therefore often settles the other, and the cards that depended on it.

**Why** under each card lists every night it paid, who was marked Credit at
that amount, and why each other player was ruled out. A card learned from a
single night is the weakest evidence, so it starts unticked. "Marked Credit"
shows how far from each payment that player was marked, for checking only:
timing never decides. Check the list, tick the cards that look right, and
**Save ticked cards** (this needs `CLOVER_ENABLED`). Saved cards match by
themselves from then on. On a phone, each card is shown as its own block.

## 5. Where it is kept

| Tab | Rows |
| --- | --- |
| `SessionPayments` | A match is the usual `credit` row, so the cash flow page and payment totals count it as Credit. |
| `CloverMatches` | One row per payment and player matched: `how` is the rule that matched it, or `hand`. A row with no player is a payment waiting for the organizer after an undo (`held`) or set aside (`ignored`). A matched payment Clover later refunded or voided keeps its rows as `refunded`. |
| `CloverLinks` | What the desk has learned: `link_key` (a card, `customer:`, `phone:` or `email:`), `player_id`, and `source` (`hand`, `name`, `records`). An empty `player_id` means the key paid for two different players and no longer matches. Delete a row to make the desk forget it. |

Both tabs are made by the first match; reading never adds them. Names, phones,
emails and the last four digits of cards stay in the private Sheet and the
owner-only desk. The audit log records each match, undo and set-aside with
the player and how many players; the public desk log gets only codes and
counts. No full card numbers are read or stored.

## 6. When something goes wrong

The desk section and the Clover page say what to fix:

| Message | Fix |
| --- | --- |
| Add `CLOVER_API_TOKEN` / `CLOVER_MERCHANT_ID` | Step 3 of Setup. |
| Clover did not accept `CLOVER_API_TOKEN` (401) | The token was deleted or mistyped: create a new one. |
| The Clover token is missing a permission (403) | It needs Read for Payments, Orders and Customers. |
| Clover does not know `CLOVER_MERCHANT_ID` (404) | Check the ID from the dashboard address. |
| Clover asked the desk to slow down (429) | The desk retries; it clears by itself. |
| Clover matching is off | Add `CLOVER_ENABLED` = `true` (Setup step 4). |

Clover's webhooks were considered and not used: they send only payment IDs,
need a public address (the desk is owner-only), and Apps Script can neither
check their `X-Clover-Auth` header nor answer them with a plain `200 OK`.
Checking once a minute while tonight is open is fast enough at the desk.
