import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@linkiq/ui';
import Link from 'next/link';

export default function RegisterPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>
          Start managing and analyzing your links with LinkIQ.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Full name</Label>
          <Input id="name" type="text" placeholder="Jane Doe" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" placeholder="you@company.com" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" placeholder="••••••••" />
        </div>
        <Button className="w-full" disabled>
          Create account
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Log in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
