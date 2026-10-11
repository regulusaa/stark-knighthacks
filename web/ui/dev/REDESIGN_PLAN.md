# Brain inspection redesign — working design study

Planning started 2026-10-10 at 23:22:44 EDT. Do not settle the design before 23:52:44 EDT. CX-9 is paused; its current implementation is preserved in `444e055`. The immediate complete-assembly framing repair is `520c976`.

## Requirements from Ray's new direction

- Codex owns the scene redesign directly; no handoff to Claude. The earlier `/web/ui` restriction is superseded for this work.
- A recognizable translucent brain and a substantial stem are independent objects. Both remain visible, selectable, movable and inspectable.
- Brain, Stem and All selection; a one-tap Split up arrangement and a smooth return to the assembled pose. Manual separation must work too.
- Fullscreen on the display, the same live scene in the controller's left pane, settings on the right, and an orbit/pinch pad across the bottom. Thin white dividers, black surfaces, white text.
- Nerve roots connect continuously into the brain's paths. Separation stretches the connecting paths without detaching their endpoints.
- Close inspection of the stem and brain reveals moving readable activity text. Text is explicitly simulated signal flow using actual layer/channel/class information, not a claim to reveal hidden reasoning.
- Initial load, fullscreen, resize, rotation, split and rejoin must frame the complete relevant geometry. The brain is the dominant subject; the crop is secondary.

## Reference evidence

- Ray's three attached images: the cropped fullscreen failure, the three-pane sketch, and the anatomical brain/stem/fiber reference.
- Previous model located at `/Users/ekene./Documents/GitHub/stark`.
- Its `public/js/display.js` uses current/target positions, `MORPH_SPEED = 0.08` and the same `CAMERA_LERP = 0.08`. Shape and camera converge together, and another command simply changes the target. Preserve that interruptible behavior with frame-rate-independent `1 - (1 - 0.08)^(dt * 60)` smoothing.
- The current renderer merges brain and stem tissue into one geometry. Decorative lower fibers are a separate disconnected mesh; the tree's one stem segment begins at y=6. These structures must be separated at construction and connected intentionally.
- Current camera fitting sampled only tissue. The immediate repair adds the full trunk and lower-fiber geometry, removes the wide-screen bypass and verifies projected bounds and centering at all four required sizes.

## Interaction model under study

1. Brain / Stem selects one object. All exposes both object handles. Tapping the object in the preview or fullscreen scene selects it too.
2. Drag a visible object handle to move that part in the camera plane; All allows either handle to be moved independently. The bottom pad always orbits, two fingers always zoom. This separates object manipulation from camera manipulation.
3. Split up places the brain and stem beside one another with a generous inspection gap. Join returns both to the authored assembly. A repeated or reversed command retargets the current motion without snapping.
4. Inspect frames the selected part and enables deeper zoom. Close-up text appears gradually with distance; it remains hidden at presentation distance.
5. Center view frames all currently placed parts; it does not silently rejoin them. Joining is an explicit action.
6. Existing driver/host ownership applies to every shared scene action. Guests can watch the live preview without taking ownership. No second display registration from a controller preview.

## Technical boundary

- `brainTissueBuild` returns separate brain/stem index ranges or part arrays. Materials share resources; selectable groups own their complete anatomy and data overlays.
- `inspection` owns selection, per-part current/target offsets, split/join and framing. One animation owner updates both object transforms and camera fit.
- Connector geometry is built once. Its vertices are deformed between endpoint transforms with smooth weights; no per-frame geometry rebuild. Root endpoints coincide with the stem and hierarchy entry points.
- Text uses a small shared atlas/billboard pool, with real atlas layer names/values and class scores. No per-frame canvas uploads; bounded label counts and distance-based opacity.
- Controller preview uses the same scene modules but no model-head preload or independent inference. It receives the authoritative image, focus, placement and view through the controller's existing connection.
- An explicit validated scene-action relay extension is needed for selection, split/join and placement. Do not overload focus-tip or encode actions in camera deltas. Camera/inspection snapshots can travel in the existing display-state envelope.
- Keep all existing inference, Steer, medical, stability and heatmap behavior intact while presentation changes. The production display remains authoritative.

## Verification required before completion

- Fullscreen default and reset at 2560×1440 and 1920×1080; preview/controller at 1180×820, 390×844 and 320px width; portrait/landscape rotation.
- Brain, Stem and All hit targets; drag each independently; repeated split/join interrupted at 25/50/75%; no teleport or camera snap.
- Project complete world bounds after every settled arrangement. Assert connected endpoints coincide after every transform, not just in screenshots.
- Stem and brain close-ups: readable animated text across multiple frames, real source values, visible simulated-flow label, no blocking of scene input.
- Real display plus host and guest controller: matching placement/view/image, ownership enforcement, late join, reconnect, hidden-tab stop/resume, no competing display registration.
- Performance measured on the Mac with both fullscreen and preview active; bounded draw calls, geometry and textures across repeated split/join/image changes.
- Capture requested screenshots via `npm run shot`, inspect them, and report physical device checks separately from browser automation.

## Unresolved design risks to test in prototypes

- Reframing must not compete with direct orbit or drag: camera motion is owned by the current explicit action and cancels when a new gesture starts.
- Dense translucent tissue plus fibers may sort incorrectly; use the existing depth prepass per part, and check front/side/three-quarter views.
- The preview must be lightweight enough for phones. Skip the 8 MB classifier head and all-gallery preload; load only the active scene assets.
- A long narrow stem can make a split layout shrink the brain too much on phones. Use viewport-aware side-by-side placement in landscape and vertical separation in portrait, with a stable transition through rotation.
- Medical/stability modes and component inspection must compose cleanly rather than replacing each other's state.

## Prototype findings (23:45 EDT)

- Split/rejoin reversals start from the current pose; both objects settle within 0.04 world units, and moving one handle leaves the other unchanged.
- Initial close-up text failed visual inspection: tiny, overlapping labels. Replaced world-size text with constant-pixel sizing, part-specific filtering and a five-label collision budget. Stem and brain close-ups now show readable separated labels; only actual layer names/dimensions and class scores are used.
- The study runs at a measured median 16.7 ms / p95 17.4 ms on the Mac (90 animation frames; 5 draw calls, 1.29M triangles). This is prototype evidence only. The production preview needs a lower-resolution tissue mesh and its own measured performance check.
- Ray clarified that phones must keep the iPad's side-by-side scene/settings layout. Do not stack those panels in portrait. Show “Rotate your phone sideways for more room.” in portrait; retain the full-width bottom pad in both orientations.
- The source model has no independent inference in the controller. Preserve that property: the display computes results, then sends a compact visual snapshot (scene offsets, camera pose, values for displayed nodes). The controller renders the snapshot using the same modules.

## Integration sequence selected for implementation after the planning window

1. Expose named tissue ranges from the worker. Create separate brain/stem meshes sharing material and buffers. Preserve the existing complete mesh API for tests and compatibility, but render the named parts in separate groups.
2. Add an inspection controller for selection, placement, split/join, bounds fitting and a shared interruptible 0.08 smoothing rate. Deep inspection lowers the camera zoom limit. Existing focus uses transformed tip positions.
3. Keep all anatomy below the connection on the stem group. Connect each root bundle to the actual trunk entry, and deform the model's stem edge from that entry into the moved Brain root. Reduce oversized tract radii; maintain actual data identities, values and focus behavior.
4. Add bounded, readable activity labels to continuous curves. Their animation is illustrative; their text is actual loaded layer/class data. Stop updates while hidden.
5. Add one validated scene-action event with host/driver permissions and a 30/s cap. It carries selection, arrangement, bounded absolute part offsets or inspect. A session sequence plus server sender identity acknowledges local preview edits without comparing controllers' sequence numbers.
6. Add read-only renderer preview mode with no display registration, classifier head or gallery preload. Parent/iframe messages validate source and origin. The preview uses cached display snapshots, adjusts framing for its own aspect, and can optimistically apply permitted object actions until acknowledged.
7. Replace the controller workspace with the shared three-pane layout. Put selection/split/inspect controls first, preserve Answers/Steer and host controls below. Neutral backgrounds, white text, thin white borders, safe areas, 48px controls. Put the source crop secondary in the display composition.
8. Verify two real pages plus a second guest with the local relay: ownership, synchronization, late join, split reversal, moving both pieces, camera/pinch/focus/reset, reconnection, hidden tabs and every gallery category. Then inspect final screenshots and provide the actual reachable display/controller links.

### Camera and state decisions

- A new action retargets current transforms; no restart from an old pose. Orbit cancels an ongoing inspection fly, and manual part drag does not trigger an auto-fit on every pointer move.
- Camera Center frames the current arrangement. Join is explicit. Resize refits a home view but preserves an intentional close-up.
- Preview camera fitting uses the same assembly bounds and direction with its own aspect ratio; a narrow panel must not crop the scene by copying the monitor's pixel framing literally.
- Local object edits are protected until their own sequence is acknowledged. Losing control, disconnecting or hiding cancels pending work immediately. A preview never queues offline commands.
- Existing trunk-interior mode retains its camera and active steering. Inspection offsets move the interior with its stem; entering a mode must not silently break connections.

## Last risk review before production edits

- Canonical offsets are absolute and bounded; every scene action has a session sequence and the relay adds the sender. This prevents a stale drag from a previous driver from overriding the current driver.
- A component drag captures one pointer ID and cancels on lost capture, rotation, hidden tab or lost permission. Extra fingers cannot redirect the handle. Orbit/pinch keeps the existing tested gesture engine.
- The preview is lazy: controls become interactive before tissue geometry finishes. It loads only the current tree, crop and atlas metadata, with lower tessellation and a 1× pixel ratio on small panels. It never downloads the classifier head.
- Split placement is relative to the current camera's horizontal axis. Brain goes left, stem goes right and up enough to keep both substantial in the viewport. Camera fitting uses all connection/root bounds; manual movement uses a stable camera until Center is pressed.
- The source crop is a small camera-anchored secondary panel. Assembly bounds center the brain/stem instead of letting the photo push the brain to one side. A pinned photo remains visible during answer focus, without entering the focus fit calculation.
- The depth pass follows each named tissue part. Global whole-brain scaling is removed so exact connector attachments cannot be pulled apart by a separate breathing transform; slow vein motion and travelling signal activity remain.
- No fabricated reasoning sentences. Text shows loaded layer names/dimensions and current class/branch model scores, under a persistent simulated-flow caption when inspecting.
- Existing mode/Steer computation stays authoritative on the display. Visual node scores and current lit class are copied into the preview; they are not recomputed there.
- Keep all existing controls available below the new selection block. A narrow settings pane scrolls internally, while preview and trackpad remain fixed. White text and neutral controls apply to Answers, Steer, modes and demo rail too.

## Test link handoff

The Mac currently uses 172.20.10.14 on the phone hotspot. Keep the redesigned server on its own port 3003 while port 3002 belongs to the other running server. After verification, open and retain a real display room, then give Ray a matching `/display?room=…` URL and `/controller?room=…` URL (plus the local host link if needed). Do not hand out the study page as the finished controller.

Planning review complete at 23:52:44 EDT (30 minutes). Production integration now follows the sequence above. Baseline anatomy/layout/framing tests passed for all nine gallery images; the controller/display demo regression is recorded separately in `.shots/redesign-baseline-demo.log`.
