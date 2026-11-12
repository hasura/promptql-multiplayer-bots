"""Tests for tools/assemble.py, using the fictional sample pull request.

Run from bot-pr-reviewbook/:  python3 -m unittest discover -s tests -v
"""
import copy
import json
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import assemble  # noqa: E402


def load(name):
    with open(os.path.join(ROOT, "sample", name)) as fh:
        return json.load(fh)


class AssembleTest(unittest.TestCase):
    def setUp(self):
        self.snapshot = load("snapshot.json")
        self.authored = load("authored.json")

    def run_assemble(self, snapshot=None, authored=None):
        return assemble.assemble(snapshot or self.snapshot, authored or self.authored, "00000000-0000-0000-0000-000000000000")

    def assertProblem(self, problems, fragment):
        self.assertTrue(any(fragment in p for p in problems), f"expected a problem containing {fragment!r}, got {problems}")

    def test_sample_passes_and_every_line_is_owned_once(self):
        content, report, problems = self.run_assemble()
        self.assertEqual(problems, [])
        self.assertEqual(content["coverage"]["files"], 7)
        self.assertEqual((content["coverage"]["add"], content["coverage"]["del"]), (29, 1))
        for f in self.snapshot["files"]:
            keys = [k for o in report["ownership"] if o["file"] == f["filename"] for k in o["keys"]]
            self.assertEqual(len(keys), len(set(keys)))
            if not f.get("binary"):
                self.assertEqual(len(keys), f["additions"] + f["deletions"])

    def test_labels_follow_groups(self):
        content, _, _ = self.run_assemble()
        self.assertEqual([s["label"] for s in content["steps"]], ["A.1", "B.1", "B.2", "C.1"])
        self.assertEqual([g["label"] for g in content["groups"]], ["A", "B", "C"])

    def test_steps_without_groups_are_numbered(self):
        authored = copy.deepcopy(self.authored)
        authored["groups"] = []
        for s in authored["steps"]:
            s.pop("group")
        content, _, problems = self.run_assemble(authored=authored)
        self.assertEqual(problems, [])
        self.assertEqual([s["label"] for s in content["steps"]], ["1", "2", "3", "4"])

    def test_unowned_line_fails(self):
        authored = copy.deepcopy(self.authored)
        authored["ownership"] = [e for e in authored["ownership"] if e["file"] != "src/config.py"]
        _, _, problems = self.run_assemble(authored=authored)
        self.assertProblem(problems, "src/config.py: new line 6 is not owned")

    def test_double_owned_line_fails(self):
        authored = copy.deepcopy(self.authored)
        authored["ownership"].append({"file": "src/upload.py", "step": "setting", "new": [[12, 12]]})
        _, _, problems = self.run_assemble(authored=authored)
        self.assertProblem(problems, "owned by more than one step")

    def test_wrong_line_text_fails(self):
        snapshot = copy.deepcopy(self.snapshot)
        snapshot["head_source"]["src/config.py"] = snapshot["head_source"]["src/config.py"].replace("max_upload_bytes", "max_bytes")
        _, _, problems = self.run_assemble(snapshot=snapshot)
        self.assertProblem(problems, "does not match the head file")

    def test_missing_file_fails(self):
        snapshot = copy.deepcopy(self.snapshot)
        snapshot["files"] = [f for f in snapshot["files"] if f["filename"] != "src/errors.py"]
        _, _, problems = self.run_assemble(snapshot=snapshot)
        self.assertProblem(problems, "GitHub reports 7 changed files but the snapshot lists 6")

    def test_removed_line_needs_a_note(self):
        authored = copy.deepcopy(self.authored)
        for e in authored["explanations"]:
            if e["step"] == "result-size" and e["file"] == "src/upload.py":
                e["notes"] = []
        _, _, problems = self.run_assemble(authored=authored)
        self.assertProblem(problems, "removed line 8")

    def test_removed_test_line_needs_a_note(self):
        snapshot = copy.deepcopy(self.snapshot)
        f = next(x for x in snapshot["files"] if x["filename"] == "tests/test_upload.py")
        f["status"] = "modified"
        head = snapshot["head_source"]["tests/test_upload.py"]
        snapshot["base_source"]["tests/test_upload.py"] = "assert old_behaviour()\n"
        f["patch"] = "@@ -1 +1,17 @@\n-assert old_behaviour()\n" + "\n".join("+" + l for l in head.split("\n")[:-1])
        f["deletions"] = 1
        snapshot["files"] = [x for x in snapshot["files"]]
        _, _, problems = self.run_assemble(snapshot=snapshot)
        self.assertProblem(problems, "tests/test_upload.py: removed line 1")

    def test_removed_documentation_line_needs_no_note(self):
        snapshot = copy.deepcopy(self.snapshot)
        f = next(x for x in snapshot["files"] if x["filename"] == "docs/limits.md")
        snapshot["base_source"]["docs/size-limits.md"] = "# Limits\n\nNotes can be up to 1 MB of text.\nOld line.\n"
        f["patch"] = f["patch"].replace("@@ -1,3 +1,6 @@", "@@ -1,4 +1,6 @@") + "\n-Old line."
        f["deletions"] = 1
        _, _, problems = self.run_assemble(snapshot=snapshot)
        self.assertEqual([p for p in problems if "removed line" in p], [])

    def test_code_needs_an_explanation(self):
        authored = copy.deepcopy(self.authored)
        authored["explanations"] = [e for e in authored["explanations"] if e["file"] != "src/errors.py"]
        _, _, problems = self.run_assemble(authored=authored)
        self.assertProblem(problems, "src/errors.py in step reject: needs an explanation")

    def test_step_needs_its_why(self):
        authored = copy.deepcopy(self.authored)
        authored["steps"][0]["why"] = ""
        _, _, problems = self.run_assemble(authored=authored)
        self.assertProblem(problems, "needs a non-empty why")

    def test_verified_generated_output_needs_evidence(self):
        authored = copy.deepcopy(self.authored)
        authored["generated"][0]["evidence"] = ""
        _, _, problems = self.run_assemble(authored=authored)
        self.assertProblem(problems, "'verified' generated output needs the command and the evidence")

    def test_generated_file_stays_in_the_review(self):
        content, _, _ = self.run_assemble()
        blocks = [b for s in content["steps"] for b in s["blocks"] if b["file"] == "src/generated/api_types.py"]
        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0]["generated"]["status"], "verified")
        self.assertEqual(blocks[0]["add"], 1)

    def test_binary_change_needs_an_entry(self):
        authored = copy.deepcopy(self.authored)
        authored["nonText"] = []
        _, _, problems = self.run_assemble(authored=authored)
        self.assertProblem(problems, "docs/images/upload-limit.png: has no text diff")

    def test_mode_only_change_is_non_text(self):
        snapshot = copy.deepcopy(self.snapshot)
        snapshot["files"].append({"filename": "tools/run.sh", "status": "changed", "additions": 0, "deletions": 0, "changes": 0, "non_text": "mode"})
        snapshot["pr"]["changed_files"] += 1
        _, _, problems = self.run_assemble(snapshot=snapshot)
        self.assertProblem(problems, "tools/run.sh: has no text diff")
        authored = copy.deepcopy(self.authored)
        authored["nonText"].append({"file": "tools/run.sh", "kind": "mode", "step": "docs", "summary": "Made executable.", "reviewed": True, "evidence": "Mode 100644 to 100755."})
        content, _, problems = self.run_assemble(snapshot=snapshot, authored=authored)
        self.assertEqual(problems, [])
        self.assertEqual(content["coverage"]["files"], 8)

    def test_unreviewed_binary_is_reported(self):
        content, _, _ = self.run_assemble()
        self.assertEqual(content["coverage"]["notReviewed"], ["docs/images/upload-limit.png"])

    def test_rename_uses_the_old_path_for_the_original(self):
        content, _, problems = self.run_assemble()
        self.assertEqual(problems, [])
        self.assertIn("docs/size-limits.md", content["sourceBase"])
        ledger = {f["path"]: f for f in content["files"]}
        self.assertEqual(ledger["docs/limits.md"]["previous"], "docs/size-limits.md")

    def test_diagram_must_reference_real_steps(self):
        authored = copy.deepcopy(self.authored)
        authored["purpose"]["diagrams"][0]["nodes"][1]["step"] = "nope"
        _, _, problems = self.run_assemble(authored=authored)
        self.assertProblem(problems, "unknown step 'nope'")

    def test_diagram_edges_must_connect_nodes(self):
        authored = copy.deepcopy(self.authored)
        authored["purpose"]["diagrams"][0]["edges"][0]["to"] = "missing"
        _, _, problems = self.run_assemble(authored=authored)
        self.assertProblem(problems, "must connect existing nodes")

    def test_serves_must_name_a_step(self):
        authored = copy.deepcopy(self.authored)
        authored["steps"][0]["serves"] = ["missing"]
        _, _, problems = self.run_assemble(authored=authored)
        self.assertProblem(problems, "serves unknown step 'missing'")

    def test_step_without_changes_fails(self):
        authored = copy.deepcopy(self.authored)
        authored["steps"].append({"id": "empty", "group": "C", "title": "t", "why": "w", "checked": "c", "result": "r", "limits": "l"})
        _, _, problems = self.run_assemble(authored=authored)
        self.assertProblem(problems, "step 'empty' shows no changes")

    def test_related_links_reach_the_content(self):
        authored = copy.deepcopy(self.authored)
        authored["related"] = [{"label": "Backend PR", "url": "https://github.com/acme/api/pull/7"}]
        content, _, problems = self.run_assemble(authored=authored)
        self.assertEqual(problems, [])
        self.assertEqual(content["meta"]["related"], authored["related"])

    def test_parse_patch_numbers_lines(self):
        hunks = assemble.parse_patch("@@ -3,2 +3,3 @@\n a\n-b\n+c\n+d")
        rows = hunks[0]["rows"]
        self.assertEqual([(r["kind"], r["old"], r["new"]) for r in rows], [("context", 3, 3), ("del", 4, None), ("add", None, 4), ("add", None, 5)])


if __name__ == "__main__":
    unittest.main()
