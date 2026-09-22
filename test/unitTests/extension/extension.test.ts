import * as assert from 'assert';
import * as vscode from 'vscode';

suite("Extension Tests", () => {
    const _extensionName = "tamasarpad.markdown-table-prettify-width";

    test("Extension exists", () => {
        assert.ok(vscode.extensions.getExtension(_extensionName));
    });

    test("Extension gets activated", () => {
         vscode.extensions.getExtension(_extensionName)!
            .activate()
            .then(() => {
                    assert.ok(true);
                }, rejectReason => {
                    assert.fail(`Extension not activated. Reason: ${rejectReason}`);
                }
            );
    });
});
