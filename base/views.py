from django.http import HttpResponse
from django.shortcuts import render, redirect
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.models import User
from django.contrib.auth import authenticate, login, logout
from django.db.models import Q
from .models import Room, Topic, Message
from .forms import RoomForm
# Create your views here.
# rooms = [
#     {'id':1, 'name':'Lets learn python django'},
#     {'id':2, 'name':'Lets learn React and Ajax'},
#     {'id':3, 'name':'Lets learn python Pivot tables, chart.js and apex charts'},
# ]
def login_page(request):
    page='login'
    if request.user.is_authenticated:
        messages.success(request, "User is already Logged in")
        return redirect('home')

    if request.method == "POST":
        username = request.POST.get('username').lower()
        password = request.POST.get('password')

        try:
            user = User.objects.get(username=username)
        except:
            messages.error(request, "User does not exist")
        user= authenticate(request, username=username, password=password)
        if user is not None:
            login(request, user)
            messages.success(request, f'Welcome {username}, You have successfully logged in')
            return redirect('home')
        else:
            messages.error(request, 'Invalid Username or Password')

    context = {'page':page}
    return render(request, 'base/login_register.html', context)

def logout_user(request):
    logout(request)
    return redirect('home')

def register_user(request):
    page="register"
    form=UserCreationForm()
    context={'page':page, 'form':form}
    if request.method == 'POST':
        form=UserCreationForm(request.POST)
        if form.is_valid:
            user=form.save(commit=False)
            user.username=user.username.lower()
            user.save()
            login(request, user)
            return redirect('home')
        else:
            messages.error(request, 'An error occured')
            return render(request, 'base/login_register.html', context)
    
    return render(request, 'base/login_register.html', context)


def home(request):
    q=request.GET.get('q')
    if request.GET.get('q') == None:
        q=''
    rooms=Room.objects.filter( #search functionality, have any of the below
        Q(topic__name__icontains=q) |
        Q(name__icontains=q) |
        Q(description__icontains=q) |
        Q(host__username__icontains=q)
    )
    topics=Topic.objects.all()
    room_count=rooms.count()
    room_messages = Message.objects.all().filter(
        Q(room__topic__name__icontains=q)
    ).order_by('-created')

    context={'rooms':rooms, 'topics':topics, 'room_count':room_count, 'room_messages':room_messages}
    return render(request, 'base/home.html', context)


def room(request, pk):
    room=Room.objects.get(id=pk)
    room_messages = room.message_set.all().order_by('-created') #get all room_messages related to this room
    participants=room.participants.all()

    if request.method == "POST":
        message=Message.objects.create(
            user=request.user,
            room=room,
            body=request.POST.get('body')
        )
        room.participants.add(request.user)
        message.save()
        return redirect('room', pk=room.id)
    context = {'room': room, 'room_messages':room_messages, 'participants':participants}
    return render(request, 'base/room.html', context)


@login_required(login_url='/login')
def create_room(request):
    form = RoomForm()
    if request.method == "POST":
        form = RoomForm(request.POST)
        if form.is_valid():
            form.save()
            return redirect('home')

    context={'form':form}
    return render(request, 'base/room_form.html', context)

@login_required(login_url='/login')
def update_room(request, pk):
    room = Room.objects.get(id=pk)
    form = RoomForm(instance=room)

    if request.user != room.host:
        return HttpResponse("You Do Not Have the Necessary Privileges!")

    if request.method == "POST":
        form = RoomForm(request.POST, instance=room)
        if form.is_valid():
            form.save()
            return redirect('home')

    context = {'form':form}
    return render(request, 'base/room_form.html', context)


@login_required(login_url='/login')
def delete_room(request, pk):
    room=Room.objects.get(id=pk)

    if request.user != room.host:
        return HttpResponse("You Do Not Have the Necessary Privileges!")

    if request.method == "POST":
        room.delete()
        return redirect('home')
    return render(request, 'base/delete.html', {'obj':room})


@login_required(login_url='/login')
def delete_message(request, pk):
    message=Message.objects.get(id=pk)

    if request.user != message.user:
        return HttpResponse("You Do Not Have the Necessary Privileges!")

    if request.method == "POST":
        message.delete()
        return redirect('home')
    return render(request, 'base/delete.html', {'obj':message})




