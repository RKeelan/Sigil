import type { ChangeSet, Text } from "@codemirror/state";

/** An edit the host has yet to confirm, as it is sent. */
export interface Unconfirmed {
  changes: ChangeSet;
  /** The text the changes apply to. */
  doc: Text;
  /** The version of the host's text that the editor knew of when it made the edit. */
  version: number;
}

/**
 * Keeps the editor's text in step with the host's. The host's text has a version, which goes up
 * by one with each change to it. The editor's text is the host's text at the last version the
 * editor knows of, with the user's edits that the host hasn't confirmed yet applied on top.
 *
 * Each edit is sent with the version the editor knows of. The host applies it only if nothing but
 * the editor has changed its text since that version, so that the edit's offsets, which allow for
 * the editor's earlier edits, still hold; it confirms each edit it applies. An edit the editor
 * sent before it heard of a change from outside is ignored. The editor fits that change in
 * around its unconfirmed edits, as CodeMirror's collaborative editing does, and sends them again
 * with the new version.
 */
export class Sync {
  private synced: Text;
  /** The text with every unconfirmed edit applied, which is the editor's text. */
  private latest: Text;
  private pending: ChangeSet[] = [];

  constructor(
    doc: Text,
    /** The version of the host's text that the editor knows of. */
    public version: number,
  ) {
    this.synced = doc;
    this.latest = doc;
  }

  /** Records an edit the user made, which the host is sent, and returns it as sent. */
  local(changes: ChangeSet): Unconfirmed {
    const doc = this.latest;
    this.latest = changes.apply(doc);
    this.pending.push(changes);
    return { changes, doc, version: this.version };
  }

  /**
   * The host applied the oldest edit it was sent, which made its text `version`. Returns false
   * for a confirmation the editor doesn't expect, which it ignores.
   */
  confirm(version: number): boolean {
    const first = this.pending[0];
    if (!first || version !== this.version + 1) return false;
    this.synced = first.apply(this.synced);
    this.pending.shift();
    this.version = version;
    return true;
  }

  /** The host's text at the version the editor knows of. */
  get doc(): Text {
    return this.synced;
  }

  /**
   * The host's text changed outside the editor, by `changes` to the text the editor knows of,
   * which made it `version`. Returns the changes to make to the editor's text, and the edits to
   * send the host again, or null if the change isn't the next version, which the editor ignores.
   */
  remote(
    changes: ChangeSet,
    version: number,
  ): { changes: ChangeSet; resend: Unconfirmed[] } | null {
    if (version !== this.version + 1) return null;
    let outside = changes;
    const rebased: ChangeSet[] = [];
    for (const edit of this.pending) {
      // Text inserted at the same place by both goes in the host's order: outside first.
      const moved = edit.map(outside);
      outside = outside.map(edit, true);
      if (!moved.empty) rebased.push(moved);
    }
    this.synced = changes.apply(this.synced);
    this.latest = this.synced;
    this.version = version;
    this.pending = [];
    return {
      changes: outside,
      resend: rebased.map((edit) => this.local(edit)),
    };
  }

  /** Starts again from the host's text at `version`, dropping the edits it hasn't confirmed. */
  reset(doc: Text, version: number) {
    this.synced = doc;
    this.latest = doc;
    this.pending = [];
    this.version = version;
  }
}
