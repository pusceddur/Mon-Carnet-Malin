require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

# Only used when the Xcode project is generated with CocoaPods instead of Swift Package Manager.
Pod::Spec.new do |s|
  s.name = 'CarnetNativeSpeech'
  s.version = package['version']
  s.summary = package['description']
  s.license = 'UNLICENSED'
  s.homepage = 'https://example.invalid'
  s.author = 'Carnet Malin'
  s.source = { :git => 'https://example.invalid', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/**/*.swift'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.9'
end
