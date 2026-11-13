// Stellt das Hauptobjekt eines Fotos frei (Apple Vision, lokal).
// Aufruf: swift freistellen.swift <eingabe> <ausgabe.png>
import Foundation
import Vision
import CoreImage
import AppKit

let args = CommandLine.arguments
guard args.count == 3 else { print("Aufruf: swift freistellen.swift <eingabe> <ausgabe.png>"); exit(1) }
let url = URL(fileURLWithPath: args[1])
guard let ns = NSImage(contentsOf: url), let cg = ns.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("Bild nicht lesbar"); exit(1)
}
let req = VNGenerateForegroundInstanceMaskRequest()
let handler = VNImageRequestHandler(cgImage: cg)
try handler.perform([req])
guard let res = req.results?.first else { print("kein Objekt gefunden"); exit(1) }
let buf = try res.generateMaskedImage(ofInstances: res.allInstances, from: handler, croppedToInstancesExtent: false)
let ci = CIImage(cvPixelBuffer: buf)
let ctx = CIContext()
try ctx.writePNGRepresentation(of: ci, to: URL(fileURLWithPath: args[2]), format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
print("ok", ci.extent.size)
