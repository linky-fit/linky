import { NonEmptyString1000 } from "@evolu/common";
import { createId } from "../model/ids";
import { linkyStore, runNow } from "../testing/linky";
import { makeContactsRepository } from "./contacts";

const name = (value: string) => NonEmptyString1000.orThrow(value);

describe("contacts repository", () => {
  it("inserts, reads, updates, and removes a contact", () => {
    const { store } = linkyStore();
    const contacts = makeContactsRepository(store);
    const id = createId<"Contact">();
    runNow(contacts.insert({ id, name: name("Alice") }));
    expect(runNow(contacts.byId(id))?.name).toBe("Alice");
    runNow(contacts.update(id, { name: name("Alicia"), nameSetByUser: 1 }));
    expect(runNow(contacts.all).map((row) => row.name)).toEqual(["Alicia"]);
    runNow(contacts.remove(id));
    expect(runNow(contacts.all)).toEqual([]);
  });

  it("keeps a contact edited after a rotation in the active shard", () => {
    const { db, store } = linkyStore();
    const contacts = makeContactsRepository(store);
    const id = createId<"Contact">();
    runNow(contacts.insert({ id, name: name("Alice") }));
    runNow(store.rotate("contacts"));
    runNow(contacts.update(id, { name: name("Alicia") }));
    const copies = runNow(db.readTable("contact"));
    expect(copies).toHaveLength(2);
    expect(runNow(contacts.all)).toMatchObject([
      { name: "Alicia", ownerId: store.shardOwner("contacts", 1).id },
    ]);
  });

  it("notifies subscribers", () => {
    const { store } = linkyStore();
    const contacts = makeContactsRepository(store);
    let calls = 0;
    contacts.subscribe(() => {
      calls += 1;
    });
    runNow(contacts.insert({ id: createId<"Contact">() }));
    expect(calls).toBe(1);
  });
});
