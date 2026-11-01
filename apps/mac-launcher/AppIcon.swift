import AppKit

// Original MARICODE artwork. Vector source is shipped with the product so the
// icon can be rebuilt without an image editor or an external asset service.
let output = CommandLine.arguments[1]
func render(_ pixels: Int, _ path: String) throws {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
                                  bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                  isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    let context = NSGraphicsContext.current!.cgContext
    context.scaleBy(x: CGFloat(pixels) / 1024, y: CGFloat(pixels) / 1024)
    let tile = NSBezierPath(roundedRect: NSRect(x: 72, y: 72, width: 880, height: 880), xRadius: 194, yRadius: 194)
    NSGraphicsContext.saveGraphicsState()
    let shadow = NSShadow(); shadow.shadowColor = NSColor.black.withAlphaComponent(0.24)
    shadow.shadowBlurRadius = 20; shadow.shadowOffset = NSSize(width: 0, height: -8); shadow.set()
    NSColor(calibratedRed: 0.14, green: 0.13, blue: 0.25, alpha: 1).setFill(); tile.fill()
    NSGraphicsContext.restoreGraphicsState()
    NSGradient(starting: NSColor(calibratedRed: 0.29, green: 0.25, blue: 0.43, alpha: 1),
               ending: NSColor(calibratedRed: 0.13, green: 0.12, blue: 0.23, alpha: 1))!.draw(in: tile, angle: -90)
    NSColor.white.withAlphaComponent(0.14).setStroke(); tile.lineWidth = 3; tile.stroke()
    func line(_ points: [NSPoint], _ color: NSColor, _ width: CGFloat) {
        let p = NSBezierPath(); p.move(to: points[0]); for point in points.dropFirst() { p.line(to: point) }
        p.lineWidth = width; p.lineCapStyle = .round; p.lineJoinStyle = .round; color.setStroke(); p.stroke()
    }
    let white = NSColor(calibratedRed: 0.96, green: 0.94, blue: 0.91, alpha: 1)
    let mint = NSColor(calibratedRed: 0.57, green: 0.88, blue: 0.79, alpha: 1)
    // Two conversational ribbons meet at the center of a wide, open M. The
    // lower left tail and detached right reply distinguish it from a terminal.
    let left = NSBezierPath()
    left.move(to: NSPoint(x: 256, y: 298)); left.line(to: NSPoint(x: 256, y: 636))
    left.curve(to: NSPoint(x: 370, y: 685), controlPoint1: NSPoint(x: 256, y: 719), controlPoint2: NSPoint(x: 315, y: 738))
    left.line(to: NSPoint(x: 512, y: 530))
    left.lineWidth = 92; left.lineCapStyle = .round; left.lineJoinStyle = .round; white.setStroke(); left.stroke()
    let right = NSBezierPath()
    right.move(to: NSPoint(x: 512, y: 530)); right.line(to: NSPoint(x: 654, y: 685))
    right.curve(to: NSPoint(x: 768, y: 636), controlPoint1: NSPoint(x: 709, y: 738), controlPoint2: NSPoint(x: 768, y: 719))
    right.line(to: NSPoint(x: 768, y: 402))
    right.lineWidth = 92; right.lineCapStyle = .round; right.lineJoinStyle = .round; mint.setStroke(); right.stroke()
    line([NSPoint(x: 256, y: 298), NSPoint(x: 350, y: 360)], white, 92)
    mint.setFill(); NSBezierPath(ovalIn: NSRect(x: 722, y: 238, width: 92, height: 92)).fill()
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path), options: .atomic)
}
for size in [16, 32, 128, 256, 512] {
    try render(size, "\(output)/icon_\(size)x\(size).png")
    try render(size * 2, "\(output)/icon_\(size)x\(size)@2x.png")
}
