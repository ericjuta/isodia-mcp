# Draw, edit, and share a diagram

Use this guide once you can open the Isodia project list. If you do not have an instance yet, follow [Getting started](getting-started.md). If someone sent you a read-only link, skip to [Read a diagram](#read-a-diagram).

## Draw your first flow

Use a synthetic example while you learn: a browser sends requests to an API, which writes to a database.

- [ ] Click **New project**, enter `Request flow`, then click **Create**.
- [ ] Click **Add item**. Search for an icon and select it to add a component. Repeat for the API and database.
- [ ] Use **Select** to drag the components apart. Click a component's icon, label, or base tile to set its **Name** in the inspector.
- [ ] Add a sentence of **Notes** to the API, such as `Validates requests before writing orders.` Click outside the field to finish the edit.
- [ ] Choose **Connect**. Click the browser's icon or label, then the API's. Repeat with the API and database.
- [ ] Wait for **Saved** in the header. Reload the editor to check that the components, notes, and connections are still there.

A **component** is the thing you describe. A **view** arranges components for one question, such as “Where does this request go?” A **connection** is a line between elements in a view. Keep facts about a component in its notes. Use separate views for different flows instead of putting every connection in one picture.

## Decide what to send

| You want to send | Use | What the recipient gets |
| --- | --- | --- |
| An image for a slide, ticket, or article | **Export → Download PNG of this view** | A static image of the active view. No clickable notes. |
| A model someone can import and edit | **Export → Download model JSON** | A copy of the whole model, not just the active view. It does not follow later edits. |
| A read-only link that follows edits | **Share** | A live project. The selected view is the starting view, not an access restriction. Anyone with the link can read it. |
| A guided tour for a public article | [Published walkthrough](walkthroughs.md) | A public, versioned snapshot of selected views, with step links and an optional iframe. Later project edits do not change it. |

A link to `localhost` opens on the recipient's own computer, not yours. Use a reachable Isodia instance to send a share link or publish a walkthrough. Review notes, names, labels, and artwork before sending any artifact. **Read-only describes what a recipient can do in Isodia, not what they can copy or forward.**

## Inspect a render before sending it

- [ ] Open the view you want to send. Use **Export → Download PNG of this view** or call `render_diagram` with the same view and `format: "png"`.
- [ ] Open the PNG at the size your reader will see it. Check component names, connector labels, and region titles. Look for text behind icons and labels that run together.
- [ ] If text is hidden, move a nearby component with **Select** or `edit_diagram`. If the view is too crowded, split it by flow or audience.
- [ ] Render again and inspect the new PNG. Do not send the earlier copy.

## Check a live share before sending it

- [ ] Review the whole project, including views other than the one you plan to share first.
- [ ] Open the starting view. Click **Share**, then **Create link opening on …**.
- [ ] Copy the link and open it in a private browser window. Check the first view and try switching views and opening component notes.
- [ ] Use **Revoke** in the **Share** panel when the link should stop working. Check it again in a fresh window. Revocation does not erase copies already made.

## Read a diagram

In a live share, use the view tabs to switch diagrams. Click a component's icon, label, or base tile to see its name and notes. If another component covers the label, try its icon or an uncovered part of the base tile. Drag to pan, or use the zoom buttons to change the scale.

In a walkthrough, follow the numbered steps or explore using the view tabs and the component picker. The picker also works with a keyboard. Choose **Return to step** to restore the guided view after exploring. If an embedded reader does not load, use the article's full-page link instead.
