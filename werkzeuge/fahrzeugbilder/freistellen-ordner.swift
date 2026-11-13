// Stellt alle Bilder eines Ordners frei (Apple Vision, lokal) und schreibt PNG mit Transparenz.
// Fuer Konfigurator-Bilder mit Studio-Hintergrund (BMW). Bereits vorhandene Ausgaben werden uebersprungen.
// Bauen: swiftc -O freistellen-ordner.swift -o freistellen-ordner
// Aufruf: ./freistellen-ordner <eingabe-ordner> <ausgabe-ordner>
import Foundation
import Vision
import CoreImage
import AppKit

let args = CommandLine.arguments
guard args.count == 3 else { print("Aufruf: freistellen-ordner <eingabe> <ausgabe>"); exit(1) }
let ein = URL(fileURLWithPath: args[1]), aus = URL(fileURLWithPath: args[2])
try? FileManager.default.createDirectory(at: aus, withIntermediateDirectories: true)
let ctx = CIContext()
let dateien = (try FileManager.default.contentsOfDirectory(atPath: ein.path)).filter { !$0.hasPrefix(".") }.sorted()
var n = 0, fehler = 0
for d in dateien {
    let ziel = aus.appendingPathComponent((d as NSString).deletingPathExtension + ".png")
    if FileManager.default.fileExists(atPath: ziel.path) { continue }
    autoreleasepool {
        guard let ns = NSImage(contentsOf: ein.appendingPathComponent(d)),
              let cg = ns.cgImage(forProposedRect: nil, context: nil, hints: nil) else { fehler += 1; return }
        let req = VNGenerateForegroundInstanceMaskRequest()
        let h = VNImageRequestHandler(cgImage: cg)
        do {
            try h.perform([req])
            guard let r = req.results?.first else { fehler += 1; return }
            let buf = try r.generateMaskedImage(ofInstances: r.allInstances, from: h, croppedToInstancesExtent: false)
            try ctx.writePNGRepresentation(of: CIImage(cvPixelBuffer: buf), to: ziel, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
            n += 1
        } catch { fehler += 1 }
    }
}
print("freigestellt", n, "fehler", fehler)
