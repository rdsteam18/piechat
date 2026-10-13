import { checkMessageEditEligibility } from "./message-actions";

function runTests() {
  const cases: { name: string; run: () => void }[] = [
    {
      name: "Direct chat: unread message can be edited",
      run: () => {
        const res = checkMessageEditEligibility({
          isSender: true,
          isDeleted: false,
          convType: "direct",
          readerCount: 0,
        });
        if (!res.allowed) throw new Error(`Expected allowed, got: ${res.reason}`);
      },
    },
    {
      name: "Direct chat: read message cannot be edited",
      run: () => {
        const res = checkMessageEditEligibility({
          isSender: true,
          isDeleted: false,
          convType: "direct",
          readerCount: 1,
        });
        if (res.allowed) throw new Error("Expected rejected for read direct message");
        if (!res.reason?.includes("already been read")) {
          throw new Error(`Unexpected reason: ${res.reason}`);
        }
      },
    },
    {
      name: "Group chat: 0 readers can be edited",
      run: () => {
        const res = checkMessageEditEligibility({
          isSender: true,
          isDeleted: false,
          convType: "group",
          readerCount: 0,
        });
        if (!res.allowed) throw new Error(`Expected allowed, got: ${res.reason}`);
      },
    },
    {
      name: "Group chat: 2 readers can be edited (at limit)",
      run: () => {
        const res = checkMessageEditEligibility({
          isSender: true,
          isDeleted: false,
          convType: "group",
          readerCount: 2,
        });
        if (!res.allowed) throw new Error(`Expected allowed, got: ${res.reason}`);
      },
    },
    {
      name: "Group chat: 3 readers cannot be edited (over limit)",
      run: () => {
        const res = checkMessageEditEligibility({
          isSender: true,
          isDeleted: false,
          convType: "group",
          readerCount: 3,
        });
        if (res.allowed) throw new Error("Expected rejected for group readerCount > 2");
        if (!res.reason?.includes("more than 2 members")) {
          throw new Error(`Unexpected reason: ${res.reason}`);
        }
      },
    },
    {
      name: "Deleted message cannot be edited",
      run: () => {
        const res = checkMessageEditEligibility({
          isSender: true,
          isDeleted: true,
          convType: "direct",
          readerCount: 0,
        });
        if (res.allowed) throw new Error("Expected rejected for deleted message");
        if (!res.reason?.includes("deleted message")) {
          throw new Error(`Unexpected reason: ${res.reason}`);
        }
      },
    },
    {
      name: "Non-sender cannot edit message",
      run: () => {
        const res = checkMessageEditEligibility({
          isSender: false,
          isDeleted: false,
          convType: "direct",
          readerCount: 0,
        });
        if (res.allowed) throw new Error("Expected rejected for non-sender");
        if (!res.reason?.includes("only edit your own")) {
          throw new Error(`Unexpected reason: ${res.reason}`);
        }
      },
    },
  ];

  let passed = 0;
  for (const c of cases) {
    try {
      c.run();
      console.log(`✓ PASSED: ${c.name}`);
      passed++;
    } catch (err) {
      console.error(`✗ FAILED: ${c.name}`, err);
      process.exitCode = 1;
    }
  }

  console.log(`\nAll tests completed: ${passed}/${cases.length} passed.`);
}

runTests();
